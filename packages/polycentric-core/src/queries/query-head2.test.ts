import * as RXJS from 'rxjs';

import * as ProcessHandle from '../process-handle';
import * as Util from '../util';
import * as Models from '../models';
import { queryHeadObservable, QueryHead } from './query-head2';
import { CancelContext } from '../cancel-context';

enum SharedTestMode {
    NetworkOnly,
    DiskOnly,
    CacheOnly,
}

async function sharedTestCase(mode: SharedTestMode): Promise<void> {
    const s1p1 = await ProcessHandle.createTestProcessHandle();
    s1p1.addAddressHint(s1p1.system(), ProcessHandle.TEST_SERVER);

    const queryHead = new QueryHead(s1p1);
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
        await observable,
        Models.signedEventToPointer,
    );

    contextHold?.cancel();

    const expected = new Map([
        [Models.Process.toString(pointer.process), pointer],
    ]);

    expect(
        Util.areMapsEqual(result, expected, Models.Pointer.equal),
    ).toStrictEqual(true);
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
});
