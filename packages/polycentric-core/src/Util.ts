import * as Base64 from '@borderless/base64';
import Long from 'long';

export type RangeItem = {
    low: number;
    high: number;
};

export function subtractRange(
    left: Array<RangeItem>,
    right: Array<RangeItem>,
): Array<RangeItem> {
    const result: Array<RangeItem> = [];

    for (const item of left) {
        result.push({
            low: item.low,
            high: item.high,
        });
    }

    for (const range of right) {
        for (let i = result.length - 1; i >= 0; i--) {
            if (range.high < result[i].low || range.low > result[i].high) {
                continue;
            } else if (
                range.low <= result[i].low &&
                range.high >= result[i].high
            ) {
                result.splice(i, 1);
            } else if (range.low <= result[i].low) {
                result[i].low = range.high + 1;
            } else if (range.high >= result[i].high) {
                result[i].high = range.low - 1;
            } else if (
                range.low > result[i].low &&
                range.high < result[i].high
            ) {
                const current = result[i];
                result.splice(i, 1);
                result.push({
                    low: current.low,
                    high: range.low - 1,
                });
                result.push({
                    low: range.high + 1,
                    high: current.high,
                });
            } else {
                throw Error('impossible');
            }
        }
    }

    return result;
}

export function sortRangeItems(ranges: Array<RangeItem>): Array<RangeItem> {
    ranges.sort((x, y) => {
        return x.low - y.low;
    });
    return ranges;
}

export function takeRangesMaxItems(
    ranges: Array<RangeItem>,
    limit: number,
): Array<RangeItem> {
    let sum = 0;
    const result: Array<RangeItem> = [];

    if (limit === 0) {
        return [];
    }

    sortRangeItems(ranges);
    ranges.reverse();

    for (const range of ranges) {
        const count = range.high - range.low + 1;
        const maxItems = limit - sum;
        if (count <= maxItems) {
            result.push(range);
            sum += count;
        } else {
            result.push({
                low: range.high - maxItems,
                high: range.high,
            });
            break;
        }
    }

    sortRangeItems(result);

    return result;
}

export function blobToURL(mime: string, blob: Uint8Array): string {
    return 'data:' + mime + ';base64,' + Base64.encode(blob);
}

export function blobsEqual(x: Uint8Array, y: Uint8Array): boolean {
    if (x.byteLength !== y.byteLength) {
        return false;
    }

    for (let i = 0; i < x.byteLength; i++) {
        if (x[i] !== y[i]) {
            return false;
        }
    }

    return true;
}

export function numberToBinary(value: number): Uint8Array {
    const long = Long.fromNumber(value, true);
    return new Uint8Array(long.toBytesLE());
}

export function numberToBinaryBE(value: number): Uint8Array {
    const long = Long.fromNumber(value, true);
    return new Uint8Array(long.toBytesBE());
}

