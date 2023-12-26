import Long from 'long';

export interface IRange {
    low: Long;
    high: Long;
}

export function toString(ranges: ReadonlyArray<IRange>): string {
    const out = ranges
        .map((r) => r.low.toString() + '-' + r.high.toString())
        .join(',');
    return out;
}

export function contains(
    ranges: ReadonlyArray<IRange>,
    item: Readonly<Long>,
): boolean {
    for (const range of ranges) {
        if (
            item.greaterThanOrEqual(range.low) &&
            item.lessThanOrEqual(range.high)
        ) {
            return true;
        }
    }

    return false;
}

export function deepCopy(ranges: ReadonlyArray<IRange>): Array<IRange> {
    return ranges.map((item) => {
        return {
            low: new Long(item.low.low, item.low.high, item.low.unsigned),
            high: new Long(item.high.low, item.high.high, item.high.unsigned),
        };
    });
}

export function insert(ranges: Array<IRange>, item: Readonly<Long>): void {
    for (let i = 0; i < ranges.length; i++) {
        // within existing range
        if (
            item.greaterThanOrEqual(ranges[i].low) &&
            item.lessThanOrEqual(ranges[i].high)
        ) {
            return;
        }

        // merging range
        if (
            i < ranges.length - 1 &&
            item.equals(ranges[i].high.add(Long.UONE)) &&
            item.equals(ranges[i + 1].low.subtract(Long.UONE))
        ) {
            ranges[i].high = ranges[i + 1].high;
            ranges.splice(i + 1, 1);
            return;
        }

        // low adjacent
        if (item.equals(ranges[i].low.subtract(Long.UONE))) {
            ranges[i].low = item;
            return;
        }

        // high adjacent
        if (item.equals(ranges[i].high.add(Long.UONE))) {
            ranges[i].high = item;
            return;
        }

        // between ranges
        if (
            item.greaterThan(ranges[i].high) &&
            i < ranges.length - 1 &&
            item.lessThan(ranges[i + 1].low)
        ) {
            ranges.splice(i + 1, 0, {
                low: item,
                high: item,
            });
            return;
        }
    }

    ranges.push({
        low: item,
        high: item,
    });
}

export function subtractRange(
    left: ReadonlyArray<IRange>,
    right: ReadonlyArray<IRange>,
): Array<IRange> {
    const result: Array<IRange> = [];

    for (const item of left) {
        result.push({
            low: item.low,
            high: item.high,
        });
    }

    for (const range of right) {
        for (let i = result.length - 1; i >= 0; i--) {
            if (
                range.high.lessThan(result[i].low) ||
                range.low.greaterThan(result[i].high)
            ) {
                continue;
            } else if (
                range.low.lessThanOrEqual(result[i].low) &&
                range.high.greaterThanOrEqual(result[i].high)
            ) {
                result.splice(i, 1);
            } else if (range.low.lessThanOrEqual(result[i].low)) {
                result[i].low = range.high.add(Long.UONE);
            } else if (range.high.greaterThanOrEqual(result[i].high)) {
                result[i].high = range.low.subtract(Long.UONE);
            } else if (
                range.low.greaterThan(result[i].low) &&
                range.high.lessThan(result[i].high)
            ) {
                const current = result[i];

                result.splice(i, 1);

                result.push({
                    low: current.low,
                    high: range.low.subtract(Long.UONE),
                });

                result.push({
                    low: range.high.add(Long.UONE),
                    high: current.high,
                });
            } else {
                throw Error('impossible');
            }
        }
    }

    return result;
}

export function takeRangesMaxItems(
    ranges: ReadonlyArray<IRange>,
    limit: Readonly<Long>,
): Array<IRange> {
    let sum = Long.UZERO;
    const result: Array<IRange> = [];

    if (limit.equals(Long.UZERO)) {
        return [];
    }

    for (const range of ranges) {
        const count = range.high.subtract(range.low).add(Long.UONE);

        const maxItems = limit.subtract(sum);

        if (count.lessThanOrEqual(maxItems)) {
            result.push(range);

            sum = sum.add(count);
        } else {
            result.push({
                high: range.low.add(maxItems),
                low: range.low,
            });

            break;
        }
    }

    return result;
}
