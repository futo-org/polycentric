import 'long';
import * as RXJS from 'rxjs';

import * as ProcessHandle from '../process-handle';
import * as Util from '../util';
import * as Models from '../models';
import { QueryEvent } from './query-event2';
import { QueryBlob, queryBlobObservable } from './query-blob2';

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

describe('query blob2', () => {
    test('query', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        const queryEvent = new QueryEvent(s1p1);
        queryEvent.shouldUseNetwork(false);
        queryEvent.shouldUseDisk(true);
        const queryBlob = new QueryBlob(queryEvent);

        const publishedRanges = await s1p1.publishBlob(testBlob);

        const result = await RXJS.firstValueFrom(
            queryBlobObservable(
                queryBlob,
                s1p1.system(),
                s1p1.process(),
                publishedRanges,
            ),
        );

        expectToBeDefined(result);

        expect(Util.buffersEqual(result, testBlob)).toStrictEqual(true);
    });
});
