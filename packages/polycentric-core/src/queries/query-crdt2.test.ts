import 'long';
import * as RXJS from 'rxjs';

import * as ProcessHandle from '../process-handle';
import * as Util from '../util';
import * as Models from '../models';
import { QueryEvent } from './query-event2';
import { QueryHead } from './query-head2';
import { queryCRDTObservable, QueryCRDT } from './query-crdt2';

function expectToBeDefined<T>(value: T): asserts value is NonNullable<T> {
    expect(value).toBeDefined();
}

describe('query crdt', () => {
    test('query', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        const queryEvent = new QueryEvent(s1p1);
        queryEvent.shouldUseNetwork(false);
        const queryHead = new QueryHead(s1p1);
        queryEvent.shouldUseNetwork(false);
        const queryCRDT = new QueryCRDT(queryHead, queryEvent);

        await s1p1.setUsername('initial');

        const result = await RXJS.firstValueFrom(
            queryCRDTObservable(
                queryCRDT,
                s1p1.system(),
                Models.ContentType.ContentTypeUsername,
            ),
        );

        expectToBeDefined(result);

        expect(Util.decodeText(result)).toStrictEqual('initial');
    });
});
