import 'long';
import * as RXJS from 'rxjs';

import * as ProcessHandle from '../process-handle';
import * as Util from '../util';
import * as Models from '../models';
import { QueryLatest } from './query-latest';
import { QueryHead } from './query-head';
import { QueryServers } from './query-servers';
import { queryCRDTObservable, QueryCRDT } from './query-crdt';
import { CancelContext } from '../cancel-context';

function expectToBeDefined<T>(value: T): asserts value is NonNullable<T> {
  expect(value).toBeDefined();
}

enum SharedTestMode {
  NetworkOnly,
  DiskOnly,
  CacheOnly,
}

async function sharedTestCase(mode: SharedTestMode): Promise<void> {
  const s1p1 = await ProcessHandle.createTestProcessHandle();
  s1p1.addAddressHint(s1p1.system(), ProcessHandle.TEST_SERVER);

  const queryServers = new QueryServers(s1p1);
  const queryHead = new QueryHead(s1p1, queryServers);
  queryHead.shouldUseNetwork(false);
  queryHead.shouldUseDisk(false);
  const queryLatest = new QueryLatest(
    s1p1.store().indexSystemProcessContentTypeLogicalClock,
    queryServers,
    queryHead,
  );
  queryLatest.shouldUseNetwork(false);
  queryLatest.shouldUseDisk(false);

  const queryCRDT = new QueryCRDT(queryHead, queryLatest);

  if (mode === SharedTestMode.NetworkOnly) {
    queryHead.shouldUseNetwork(true);
    queryLatest.shouldUseNetwork(true);
  } else if (mode === SharedTestMode.DiskOnly) {
    queryHead.shouldUseDisk(true);
    queryLatest.shouldUseDisk(true);
  }

  const contextHold =
    mode === SharedTestMode.CacheOnly ? new CancelContext() : undefined;

  if (mode === SharedTestMode.CacheOnly) {
    s1p1.setListener((event) => {
      queryHead.updateWithContextHold(event, contextHold);
      queryLatest.updateWithContextHold(event, contextHold);
    });
  }

  await s1p1.setUsername('initial');

  if (mode === SharedTestMode.NetworkOnly) {
    await ProcessHandle.fullSync(s1p1);
  }

  let wasInstant = false;

  const observable = RXJS.firstValueFrom(
    queryCRDTObservable(
      queryCRDT,
      s1p1.system(),
      Models.ContentType.ContentTypeUsername,
    ).pipe(
      RXJS.switchMap((value) => {
        wasInstant = true;
        return RXJS.of(value);
      }),
    ),
  );

  expect(wasInstant).toStrictEqual(mode === SharedTestMode.CacheOnly);

  const result = await observable;

  contextHold?.cancel();

  expectToBeDefined(result.value);

  expect(result.missingData).toStrictEqual(false);
  expect(Util.decodeText(result.value)).toStrictEqual('initial');

  expect(queryCRDT.clean).toStrictEqual(true);

  if (mode !== SharedTestMode.CacheOnly) {
    const dualQueryResult = await RXJS.firstValueFrom(
      RXJS.combineLatest(
        queryCRDTObservable(
          queryCRDT,
          s1p1.system(),
          Models.ContentType.ContentTypeUsername,
        ),
        queryCRDTObservable(
          queryCRDT,
          s1p1.system(),
          Models.ContentType.ContentTypeUsername,
        ),
      ),
    );

    expect(dualQueryResult[0] === dualQueryResult[1]).toStrictEqual(true);

    expect(queryCRDT.clean).toStrictEqual(true);
  }

  queryCRDTObservable(
    queryCRDT,
    s1p1.system(),
    Models.ContentType.ContentTypeUsername,
  )
    .subscribe()
    .unsubscribe();

  expect(queryCRDT.clean).toStrictEqual(true);
}

describe('query crdt', () => {
  test('hit disk', async () => {
    await sharedTestCase(SharedTestMode.DiskOnly);
  });

  test('hit network', async () => {
    await sharedTestCase(SharedTestMode.NetworkOnly);
  });

  test('context hold', async () => {
    await sharedTestCase(SharedTestMode.CacheOnly);
  });

  test('outdated', async () => {
    const s1p1 = await ProcessHandle.createTestProcessHandle();
    const s2p1 = await ProcessHandle.createTestProcessHandle();

    const queryServers = new QueryServers(s2p1);
    const queryHead = new QueryHead(s2p1, queryServers);
    queryHead.shouldUseNetwork(false);
    const queryLatest = new QueryLatest(
      s2p1.store().indexSystemProcessContentTypeLogicalClock,
      queryServers,
      queryHead,
    );
    queryLatest.shouldUseNetwork(false);

    const queryCRDT = new QueryCRDT(queryHead, queryLatest);

    const initial = await s1p1.setUsername('1');
    await s1p1.setUsername('2');
    const head = await s1p1.post('3');

    await ProcessHandle.copyEventBetweenHandles(initial, s1p1, s2p1);
    await ProcessHandle.copyEventBetweenHandles(head, s1p1, s2p1);

    const result = await RXJS.firstValueFrom(
      queryCRDTObservable(
        queryCRDT,
        s1p1.system(),
        Models.ContentType.ContentTypeUsername,
      ).pipe(
        RXJS.switchMap((value) => {
          return RXJS.of(value);
        }),
      ),
    );

    expectToBeDefined(result.value);

    expect(result.missingData).toStrictEqual(true);
    expect(Util.decodeText(result.value)).toStrictEqual('1');

    expect(queryCRDT.clean).toStrictEqual(true);
  });

  test('never set', async () => {
    const s1p1 = await ProcessHandle.createTestProcessHandle();

    const queryServers = new QueryServers(s1p1);
    const queryHead = new QueryHead(s1p1, queryServers);
    queryHead.shouldUseNetwork(false);
    const queryLatest = new QueryLatest(
      s1p1.store().indexSystemProcessContentTypeLogicalClock,
      queryServers,
      queryHead,
    );
    queryLatest.shouldUseNetwork(false);
    const queryCRDT = new QueryCRDT(queryHead, queryLatest);

    const result = await RXJS.firstValueFrom(
      queryCRDTObservable(
        queryCRDT,
        s1p1.system(),
        Models.ContentType.ContentTypeUsername,
      ),
    );

    expect(result.missingData).toStrictEqual(false);
    expect(result.value).toStrictEqual(undefined);
  });
});
