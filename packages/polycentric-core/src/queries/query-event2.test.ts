import * as RXJS from 'rxjs';

import * as ProcessHandle from '../process-handle';
import * as Models from '../models';
import { queryEventObservable, QueryEvent } from './query-event2';

function expectToBeDefined<T>(value: T): asserts value is NonNullable<T> {
    expect(value).toBeDefined();
}

describe('query event2', () => {
    test('hit disk basic', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        const queryEvent = new QueryEvent(s1p1);
        queryEvent.shouldUseNetwork(false);

        const pointer = await s1p1.post('hello');

        const result = await RXJS.firstValueFrom(
            queryEventObservable(
                queryEvent,
                pointer.system,
                pointer.process,
                pointer.logicalClock,
            ),
        );

        expect(
            Models.Pointer.equal(pointer, Models.signedEventToPointer(result)),
        ).toStrictEqual(true);
    });

    test('hit disk delete', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();
        const queryEvent = new QueryEvent(s1p1);
        queryEvent.shouldUseNetwork(false);

        const messagePointer = await s1p1.post('hello');

        const deletePointer = await s1p1.delete(
            messagePointer.process,
            messagePointer.logicalClock,
        );

        expectToBeDefined(deletePointer);

        const messageResult = await RXJS.firstValueFrom(
            queryEventObservable(
                queryEvent,
                messagePointer.system,
                messagePointer.process,
                messagePointer.logicalClock,
            ),
        );

        expect(
            Models.Pointer.equal(
                deletePointer,
                Models.signedEventToPointer(messageResult),
            ),
        ).toStrictEqual(true);

        const deleteResult = await RXJS.firstValueFrom(
            queryEventObservable(
                queryEvent,
                deletePointer.system,
                deletePointer.process,
                deletePointer.logicalClock,
            ),
        );

        expect(
            Models.Pointer.equal(
                deletePointer,
                Models.signedEventToPointer(deleteResult),
            ),
        ).toStrictEqual(true);
    });
});
