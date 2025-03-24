import * as RXJS from 'rxjs';

import { CancelContext } from '../cancel-context';
import * as Models from '../models';
import * as ProcessHandle from '../process-handle';
import * as Util from '../util';
import { QueryHead, queryHeadObservable } from './query-head';
import { QueryServers } from './query-servers';

enum SharedTestMode {
  NetworkOnly,
  DiskOnly,
  CacheOnly,
}

async function waitForEvent(
  processHandle: ProcessHandle.ProcessHandle,
  pointer: Models.Pointer.Pointer,
): Promise<Models.SignedEvent.SignedEvent | undefined> {
  let loadedEvent: Models.SignedEvent.SignedEvent | undefined = undefined;

  for (let i = 0; i < 20 && !loadedEvent; i++) {
    loadedEvent = await processHandle
      .store()
      .indexEvents.getSignedEvent(
        pointer.system,
        pointer.process,
        pointer.logicalClock,
      );

    await Util.sleep(100);
  }

  return loadedEvent;
}

function expectToBeDefined<T>(value: T): asserts value is NonNullable<T> {
  expect(value).toBeDefined();
}

async function sharedTestCase(mode: SharedTestMode): Promise<void> {
  const s1p1 = await ProcessHandle.createTestProcessHandle();
  s1p1.addAddressHint(s1p1.system(), ProcessHandle.TEST_SERVER);

  const queryServers = new QueryServers(s1p1);
  const queryHead = new QueryHead(s1p1, queryServers);
  queryHead.shouldUseNetwork(false);
  queryHead.shouldUseDisk(false);

  let expectedSource = 'unknown';

  if (mode === SharedTestMode.NetworkOnly) {
    queryHead.shouldUseNetwork(true);
    expectedSource = ProcessHandle.TEST_SERVER;
  } else if (mode === SharedTestMode.DiskOnly) {
    queryHead.shouldUseDisk(true);
    expectedSource = 'disk';
  }

  const contextHold =
    mode === SharedTestMode.CacheOnly ? new CancelContext() : undefined;

  if (mode === SharedTestMode.CacheOnly) {
    s1p1.setListener((event) => {
      queryHead.updateWithContextHold(event, contextHold);
    });
  }

  const pointer = await s1p1.post('hello');

  if (mode === SharedTestMode.NetworkOnly) {
    await ProcessHandle.fullSync(s1p1);
  }

  let wasInstant = false;
  const observable = RXJS.firstValueFrom(
    queryHeadObservable(queryHead, pointer.system).pipe(
      RXJS.switchMap((head) => {
        wasInstant = true;
        return RXJS.of(head);
      }),
    ),
  );

  expect(wasInstant).toStrictEqual(mode === SharedTestMode.CacheOnly);

  const result = await observable;

  const resultHead = Util.mapOverMap(result.head, Models.signedEventToPointer);

  if (contextHold) {
    expect(queryHead.clean).toStrictEqual(false);
    contextHold.cancel();
  }

  const expectedHead = new Map([
    [Models.Process.toString(pointer.process), pointer],
  ]);

  expect(
    Util.areSetsEqual(
      result.attemptedSources,
      new Set([expectedSource]),
      (a, b) => a === b,
    ),
  ).toStrictEqual(true);

  expect(
    Util.areMapsEqual(resultHead, expectedHead, Models.Pointer.equal),
  ).toStrictEqual(true);

  expect(queryHead.clean).toStrictEqual(true);

  if (mode !== SharedTestMode.CacheOnly) {
    const dualQueryResult = await RXJS.firstValueFrom(
      RXJS.combineLatest(
        queryHeadObservable(queryHead, s1p1.system()),
        queryHeadObservable(queryHead, s1p1.system()),
      ),
    );

    expect(dualQueryResult[0] === dualQueryResult[1]).toStrictEqual(true);

    expect(queryHead.clean).toStrictEqual(true);
  }

  queryHeadObservable(queryHead, s1p1.system()).subscribe().unsubscribe();

  expect(queryHead.clean).toStrictEqual(true);
}

describe('query head', () => {
  test('hit disk', async () => {
    await sharedTestCase(SharedTestMode.DiskOnly);
  });

  test('hit network', async () => {
    await sharedTestCase(SharedTestMode.NetworkOnly);
  });

  test('context hold', async () => {
    await sharedTestCase(SharedTestMode.CacheOnly);
  });

  test('no data', async () => {
    const s1p1 = await ProcessHandle.createTestProcessHandle();

    const queryServers = new QueryServers(s1p1);
    const queryHead = new QueryHead(s1p1, queryServers);
    queryHead.shouldUseNetwork(false);

    const result = await RXJS.firstValueFrom(
      queryHeadObservable(queryHead, s1p1.system()),
    );

    expect(queryHead.clean).toStrictEqual(true);
    expect(result.head.size).toStrictEqual(0);
    expect(
      Util.areSetsEqual(
        result.attemptedSources,
        new Set(['disk']),
        (a, b) => a === b,
      ),
    ).toStrictEqual(true);

    const dualQueryResult = await RXJS.firstValueFrom(
      RXJS.combineLatest(
        queryHeadObservable(queryHead, s1p1.system()),
        queryHeadObservable(queryHead, s1p1.system()),
      ),
    );

    expect(dualQueryResult[0] === dualQueryResult[1]).toStrictEqual(true);

    expect(queryHead.clean).toStrictEqual(true);
  });

  test('multiple processes', async () => {
    const s1p1 = await ProcessHandle.createTestProcessHandle();
    await s1p1.addServer(ProcessHandle.TEST_SERVER);
    const s1p1Post = await s1p1.post('s1p1');
    await s1p1.synchronizer.debugWaitUntilSynchronizationComplete();

    const s1p2 = await ProcessHandle.testProcessHandleCreateNewProcess(s1p1);
    await s1p2.addServer(ProcessHandle.TEST_SERVER);

    expect(await waitForEvent(s1p2, s1p1Post)).toBeDefined();
    const s1p2Post = await s1p2.post('s1p2');
    await s1p2.synchronizer.debugWaitUntilSynchronizationComplete();

    const head = await RXJS.firstValueFrom(
      queryHeadObservable(s1p2.queryManager.queryHead, s1p2.system()).pipe(
        RXJS.switchMap((head) => {
          if (
            head.attemptedSources.has('disk') &&
            head.attemptedSources.has(ProcessHandle.TEST_SERVER)
          ) {
            return RXJS.of(head);
          } else {
            return RXJS.NEVER;
          }
        }),
      ),
    );

    // assert that the head is correct
    expect(
      Util.areMapsEqual(
        Util.mapOverMap(head.head, Models.signedEventToPointer),
        new Map([
          [Models.Process.toString(s1p1.process()), s1p1Post],
          [Models.Process.toString(s1p2.process()), s1p2Post],
        ]),
        Models.Pointer.equal,
      ),
    ).toStrictEqual(true);

    // assert that the process list is correct
    expect(head.processLists.size).toStrictEqual(1);
    const s1p2ProcessListSignedEvent = head.processLists.get(
      Models.Process.toString(s1p2.process()),
    );
    expectToBeDefined(s1p2ProcessListSignedEvent);
    const s1p2ProcessListEvent = Models.Event.fromBuffer(
      s1p2ProcessListSignedEvent.event,
    );
    const s1p2ProcessList = Models.SystemProcesses.fromBuffer(
      s1p2ProcessListEvent.content,
    );
    expect(s1p2ProcessList.processes.length).toStrictEqual(1);
    expect(
      Models.Process.equal(s1p1.process(), s1p2ProcessList.processes[0]),
    ).toStrictEqual(true);

    // assert that the vector clock is correctly updated
    const s1p2HeadSignedEvent = head.head.get(
      Models.Process.toString(s1p2.process()),
    );
    expectToBeDefined(s1p2HeadSignedEvent);
    const s1p2HeadEvent = Models.Event.fromBuffer(s1p2HeadSignedEvent.event);
    expect(s1p2HeadEvent.vectorClock).toStrictEqual({
      logicalClocks: [s1p1Post.logicalClock],
    });
  });

  test('multiple sources', async () => {
    const s1p1 = await ProcessHandle.createTestProcessHandle();
    await s1p1.addServer(ProcessHandle.TEST_SERVER);
    await s1p1.post('test');
    await ProcessHandle.fullSync(s1p1);

    const queryServers = new QueryServers(s1p1);
    const queryHead = new QueryHead(s1p1, queryServers);

    const result = await RXJS.firstValueFrom(
      queryHeadObservable(queryHead, s1p1.system()).pipe(
        RXJS.switchMap((head) => {
          if (
            head.attemptedSources.has('disk') &&
            head.attemptedSources.has(ProcessHandle.TEST_SERVER)
          ) {
            return RXJS.of(head);
          } else {
            return RXJS.NEVER;
          }
        }),
      ),
    );

    expect(queryHead.clean).toStrictEqual(true);
    expect(result.head.size).toStrictEqual(1);
    expect(
      Util.areSetsEqual(
        result.attemptedSources,
        new Set(['disk', ProcessHandle.TEST_SERVER]),
        (a, b) => a === b,
      ),
    ).toStrictEqual(true);
  });
});
