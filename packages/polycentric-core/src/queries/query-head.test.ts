import * as RXJS from 'rxjs';

import * as ProcessHandle from '../process-handle';
import * as Util from '../util';
import * as Models from '../models';
import { queryHeadObservable, QueryHead } from './query-head';
import { QueryServers } from './query-servers';
import { CancelContext } from '../cancel-context';

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

    const resultHead = Util.mapOverMap(
        result.head,
        Models.signedEventToPointer,
    );

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

describe('query head2', () => {
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

    test('no data', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        s1p1.addServer(ProcessHandle.TEST_SERVER);
        const s1p1Post = await s1p1.post('s1p1');
        await s1p1.synchronizer.debugWaitUntilSynchronizationComplete();

        const s1p2 = await ProcessHandle.testProcessHandleCreateNewProcess(
            s1p1,
        );
        s1p2.addServer(ProcessHandle.TEST_SERVER);

        expect(await waitForEvent(s1p2, s1p1Post)).toBeDefined();

        s1p1.synchronizer.cleanup();
        s1p2.synchronizer.cleanup();
    });
});
