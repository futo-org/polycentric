import * as RXJS from 'rxjs';

import * as ProcessHandle from '../process-handle';
import * as Util from '../util';
import * as Models from '../models';
import { queryHeadObservable, QueryHead } from './query-head2';
import { QueryServers } from './query-servers';
import { CancelContext } from '../cancel-context';

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

    if (mode === SharedTestMode.NetworkOnly) {
        queryHead.shouldUseNetwork(true);
    } else if (mode === SharedTestMode.DiskOnly) {
        queryHead.shouldUseDisk(true);
    }

    const contextHold =
        mode === SharedTestMode.CacheOnly ? new CancelContext() : undefined;

    if (mode === SharedTestMode.CacheOnly) {
        s1p1.setListener((event) =>
            queryHead.updateWithContextHold(event, contextHold),
        );
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

    const result = Util.mapOverMap(
        (await observable).head,
        Models.signedEventToPointer,
    );

    if (contextHold) {
        expect(queryHead.clean).toStrictEqual(false);
        contextHold.cancel();
    }

    const expected = new Map([
        [Models.Process.toString(pointer.process), pointer],
    ]);

    expect(
        Util.areMapsEqual(result, expected, Models.Pointer.equal),
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

        const dualQueryResult = await RXJS.firstValueFrom(
            RXJS.combineLatest(
                queryHeadObservable(queryHead, s1p1.system()),
                queryHeadObservable(queryHead, s1p1.system()),
            ),
        );

        expect(dualQueryResult[0] === dualQueryResult[1]).toStrictEqual(true);

        expect(queryHead.clean).toStrictEqual(true);
    });

    test('instantly cancelled', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        s1p1.addAddressHint(s1p1.system(), ProcessHandle.TEST_SERVER);

        const queryServers = new QueryServers(s1p1);
        const queryHead = new QueryHead(s1p1, queryServers);

        await s1p1.post('yo');

        queryHeadObservable(queryHead, s1p1.system()).subscribe().unsubscribe();

        expect(queryHead.clean).toStrictEqual(true);
    });
});
