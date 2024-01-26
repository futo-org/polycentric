import 'long';
import * as RXJS from 'rxjs';

import * as ProcessHandle from '../process-handle';
import * as Util from '../util';
import * as Models from '../models';
import { QueryEvent } from './query-event2';
import { QueryHead } from './query-head2';
import { queryCRDTObservable, QueryCRDT } from './query-crdt2';
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

    const queryEvent = new QueryEvent(s1p1);
    queryEvent.shouldUseNetwork(false);
    queryEvent.shouldUseDisk(false);
    const queryHead = new QueryHead(s1p1);
    queryHead.shouldUseNetwork(false);
    queryHead.shouldUseDisk(false);
    const queryCRDT = new QueryCRDT(queryHead, queryEvent);

    if (mode === SharedTestMode.NetworkOnly) {
        queryEvent.shouldUseNetwork(true);
        queryHead.shouldUseNetwork(true);
    } else if (mode === SharedTestMode.DiskOnly) {
        queryEvent.shouldUseDisk(true);
        queryHead.shouldUseDisk(true);
    }

    const contextHold =
        mode === SharedTestMode.CacheOnly ? new CancelContext() : undefined;

    if (mode === SharedTestMode.CacheOnly) {
        s1p1.setListener((event) => {
            queryEvent.updateWithContextHold(event, contextHold);
            queryHead.updateWithContextHold(event, contextHold);
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

    expectToBeDefined(result);

    expect(Util.decodeText(result)).toStrictEqual('initial');
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
});
