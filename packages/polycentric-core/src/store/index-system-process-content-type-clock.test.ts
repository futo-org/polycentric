import * as ProcessHandle from '../process-handle';
import * as Models from '../models';

function expectToBeDefined<T>(value: T): asserts value is NonNullable<T> {
    expect(value).toBeDefined();
}

describe('IndexSystemProcessContentTypeClock', () => {
    test('value does not exist', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        const result = await s1p1
            .store()
            .indexSystemProcessContentTypeLogicalClock.getLatest(
                s1p1.system(),
                s1p1.process(),
                Models.ContentType.ContentTypeUsername,
            );

        expect(result).toStrictEqual(undefined);
    });

    test('value exists', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        await s1p1.setUsername('1');
        await s1p1.setUsername('2');
        const expected = await s1p1.setUsername('3');

        const result = await s1p1
            .store()
            .indexSystemProcessContentTypeLogicalClock.getLatest(
                s1p1.system(),
                s1p1.process(),
                Models.ContentType.ContentTypeUsername,
            );

        expectToBeDefined(result);

        expect(
            Models.Pointer.equal(expected, Models.signedEventToPointer(result)),
        ).toStrictEqual(true);
    });

    test('value deleted', async () => {
        const s1p1 = await ProcessHandle.createTestProcessHandle();

        await s1p1.setUsername('1');
        await s1p1.setUsername('2');
        const latestPointer = await s1p1.setUsername('3');
        const expected = await s1p1.delete(
            latestPointer.process,
            latestPointer.logicalClock,
        );

        expectToBeDefined(expected);

        const resultForEvent = await s1p1
            .store()
            .indexSystemProcessContentTypeLogicalClock.getLatest(
                s1p1.system(),
                s1p1.process(),
                Models.ContentType.ContentTypeUsername,
            );

        expectToBeDefined(resultForEvent);

        expect(
            Models.Pointer.equal(
                expected,
                Models.signedEventToPointer(resultForEvent),
            ),
        ).toStrictEqual(true);

        const resultForDelete = await s1p1
            .store()
            .indexSystemProcessContentTypeLogicalClock.getLatest(
                s1p1.system(),
                s1p1.process(),
                Models.ContentType.ContentTypeDelete,
            );

        expectToBeDefined(resultForDelete);

        expect(
            Models.Pointer.equal(
                expected,
                Models.signedEventToPointer(resultForDelete),
            ),
        ).toStrictEqual(true);
    });
});
