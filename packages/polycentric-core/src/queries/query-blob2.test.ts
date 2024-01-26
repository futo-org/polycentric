import 'long';
import * as RXJS from 'rxjs';

import * as ProcessHandle from '../process-handle';
import * as Util from '../util';
import { QueryEvent } from './query-event2';
import { QueryBlob, queryBlobObservable } from './query-blob2';
import { CancelContext } from '../cancel-context';

const testBlob = (() => {
    const blob = new Uint8Array(1024 * 512 * 3);
    blob[0] = 6;
    blob[1024 * 512] = 7;
    blob[1024 * 512 * 2] = 8;
    return blob;
})();

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

    const queryEvent = new QueryEvent(s1p1);
    queryEvent.shouldUseNetwork(false);
    queryEvent.shouldUseDisk(false);
    const queryBlob = new QueryBlob(queryEvent);

    if (mode === SharedTestMode.NetworkOnly) {
        queryEvent.shouldUseNetwork(true);
    } else if (mode === SharedTestMode.DiskOnly) {
        queryEvent.shouldUseDisk(true);
    }

    const contextHold =
        mode === SharedTestMode.CacheOnly ? new CancelContext() : undefined;

    if (mode === SharedTestMode.CacheOnly) {
        s1p1.setListener((event) =>
            queryEvent.updateWithContextHold(event, contextHold),
        );
    }

    const publishedRanges = await s1p1.publishBlob(testBlob);

    if (mode === SharedTestMode.NetworkOnly) {
        await ProcessHandle.fullSync(s1p1);
    }

    let wasInstant = false;

    const observable = RXJS.firstValueFrom(
        queryBlobObservable(
            queryBlob,
            s1p1.system(),
            s1p1.process(),
            publishedRanges,
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

    expectToBeDefined(result);

    expect(Util.buffersEqual(result, testBlob)).toStrictEqual(true);
}

describe('query blob2', () => {
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
