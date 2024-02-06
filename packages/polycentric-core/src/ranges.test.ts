import Long from 'long';

import * as Ranges from './ranges';

function makeRange(low: number, high: number): Ranges.IRange {
    return {
        low: Long.fromNumber(low, true),
        high: Long.fromNumber(high, true),
    };
}

describe('insert', () => {
    test('singleton', () => {
        const ranges: Array<Ranges.IRange> = [];
        Ranges.insert(ranges, new Long(5, 0, true));
        expect(ranges).toStrictEqual([makeRange(5, 5)]);
    });

    test('sequential', () => {
        const ranges: Array<Ranges.IRange> = [];
        Ranges.insert(ranges, new Long(5, 0, true));
        Ranges.insert(ranges, new Long(6, 0, true));
        expect(ranges).toStrictEqual([makeRange(5, 6)]);
    });

    test('reverse', () => {
        const ranges: Array<Ranges.IRange> = [];
        Ranges.insert(ranges, new Long(6, 0, true));
        Ranges.insert(ranges, new Long(5, 0, true));
        expect(ranges).toStrictEqual([makeRange(5, 6)]);
    });

    test('merge', () => {
        const ranges: Array<Ranges.IRange> = [];
        Ranges.insert(ranges, new Long(5, 0, true));
        Ranges.insert(ranges, new Long(7, 0, true));
        Ranges.insert(ranges, new Long(6, 0, true));

        expect(ranges).toStrictEqual([makeRange(5, 7)]);
    });

    test('disconnected insert', () => {
        const ranges: Array<Ranges.IRange> = [];
        Ranges.insert(ranges, new Long(1, 0, true));
        Ranges.insert(ranges, new Long(5, 0, true));
        Ranges.insert(ranges, new Long(3, 0, true));
        expect(ranges).toStrictEqual([
            makeRange(1, 1),
            makeRange(3, 3),
            makeRange(5, 5),
        ]);
    });

    test('non adjacent less than single item', () => {
        const ranges: Array<Ranges.IRange> = [];
        Ranges.insert(ranges, new Long(10, 0, true));
        Ranges.insert(ranges, new Long(5, 0, true));
        expect(ranges).toStrictEqual([makeRange(5, 5), makeRange(10, 10)]);
    });
});

describe('subtractRange', () => {
    test('both empty are empty', () => {
        expect(Ranges.subtractRange([], [])).toStrictEqual([]);
    });

    test('left empty result empty', () => {
        expect(Ranges.subtractRange([], [makeRange(5, 10)])).toStrictEqual([]);
    });

    test('right empty is identity', () => {
        expect(Ranges.subtractRange([makeRange(5, 10)], [])).toStrictEqual([
            makeRange(5, 10),
        ]);
    });

    test('right totally subtracts left', () => {
        expect(
            Ranges.subtractRange([makeRange(5, 10)], [makeRange(5, 10)]),
        ).toStrictEqual([]);
    });

    test('right subtracts lower portion of left', () => {
        expect(
            Ranges.subtractRange([makeRange(5, 10)], [makeRange(3, 7)]),
        ).toStrictEqual([makeRange(8, 10)]);
    });

    test('right subtracts higher portion of left', () => {
        expect(
            Ranges.subtractRange([makeRange(5, 10)], [makeRange(7, 15)]),
        ).toStrictEqual([makeRange(5, 6)]);
    });

    test('right splits middle of left', () => {
        expect(
            Ranges.subtractRange([makeRange(1, 10)], [makeRange(3, 6)]),
        ).toStrictEqual([makeRange(1, 2), makeRange(7, 10)]);
    });

    test('complex', () => {
        expect(
            Ranges.subtractRange(
                [makeRange(1, 10), makeRange(20, 30), makeRange(50, 50)],
                [makeRange(0, 5), makeRange(8, 12), makeRange(31, 60)],
            ),
        ).toStrictEqual([makeRange(6, 7), makeRange(20, 30)]);
    });
});

describe('takeRangeMaxItems', () => {
    test('empty returns empty', () => {
        expect(
            Ranges.takeRangesMaxItems([], Long.fromNumber(10, true)),
        ).toStrictEqual([]);
    });

    test('zero and non empty returns empty', () => {
        expect(
            Ranges.takeRangesMaxItems([makeRange(51, 70)], Long.UZERO),
        ).toStrictEqual([]);
    });

    test('less than total truncates', () => {
        expect(
            Ranges.takeRangesMaxItems(
                [makeRange(5, 10), makeRange(11, 15), makeRange(20, 25)],
                Long.fromNumber(8, true),
            ),
        ).toStrictEqual([makeRange(5, 10), makeRange(11, 13)]);
    });

    test('more than total uses all', () => {
        expect(
            Ranges.takeRangesMaxItems(
                [makeRange(5, 10), makeRange(10, 15), makeRange(20, 25)],
                Long.fromNumber(50, true),
            ),
        ).toStrictEqual([
            makeRange(5, 10),
            makeRange(10, 15),
            makeRange(20, 25),
        ]);
    });
});

describe('misc', () => {
    test('toArray', () => {
        expect(
            Ranges.toArray([makeRange(3, 5), makeRange(7, 7)]),
        ).toStrictEqual([
            Long.fromNumber(3, true),
            Long.fromNumber(4, true),
            Long.fromNumber(5, true),
            Long.fromNumber(7, true),
        ]);
    });
});
