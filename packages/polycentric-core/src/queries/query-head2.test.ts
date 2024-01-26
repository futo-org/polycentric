import * as RXJS from 'rxjs';

import * as ProcessHandle from '../process-handle';
import * as Util from '../util';
import * as Models from '../models';
import { queryHeadObservable, QueryHead } from './query-head2';

async function sharedTestCase(
    shouldUseNetwork: boolean,
    shouldUseDisk: boolean,
): Promise<void> {
    const s1p1 = await ProcessHandle.createTestProcessHandle();
    s1p1.addAddressHint(s1p1.system(), ProcessHandle.TEST_SERVER);

    const queryHead = new QueryHead(s1p1);
    queryHead.shouldUseNetwork(shouldUseNetwork);
    queryHead.shouldUseDisk(shouldUseDisk);

    const pointer = await s1p1.post('hello');

    if (shouldUseNetwork) {
        await ProcessHandle.fullSync(s1p1);
    }

    const result = Util.mapOverMap(
        await RXJS.firstValueFrom(
            queryHeadObservable(queryHead, pointer.system),
        ),
        Models.signedEventToPointer,
    );

    const expected = new Map([
        [Models.Process.toString(pointer.process), pointer],
    ]);

    expect(
        Util.areMapsEqual(result, expected, Models.Pointer.equal),
    ).toStrictEqual(true);
}

describe('query head2', () => {
    test('hit disk', async () => {
        await sharedTestCase(false, true);
    });

    test('hit network', async () => {
        await sharedTestCase(true, false);
    });
});
