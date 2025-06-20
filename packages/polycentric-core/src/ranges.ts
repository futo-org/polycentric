import Long from 'long';

export interface IRange {
  low: Long;
  high: Long;
}

export function toString(ranges: readonly IRange[]): string {
  const out = ranges
    .map((r) => r.low.toString() + '-' + r.high.toString())
    .join(',');
  return out;
}

export function contains(
  ranges: readonly IRange[],
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

export function validateInvariants(ranges: readonly IRange[]): boolean {
  for (let i = 0; i < ranges.length; i++) {
    if (ranges[i].low.greaterThan(ranges[i].high)) {
      return false;
    }

    if (i + 1 < ranges.length) {
      if (ranges[i].high.greaterThanOrEqual(ranges[i + 1].low)) {
        return false;
      }
    }
  }

  return true;
}

export function deepCopy(ranges: readonly IRange[]): IRange[] {
  return ranges.map((item) => {
    return {
      low: Long.fromValue(item.low),
      high: Long.fromValue(item.high),
    };
  });
}

export function insert(ranges: IRange[], item: Readonly<Long>): boolean {
  for (let i = 0; i < ranges.length; i++) {
    // within existing range
    if (
      item.greaterThanOrEqual(ranges[i].low) &&
      item.lessThanOrEqual(ranges[i].high)
    ) {
      return false;
    }

    // merging range
    if (
      i < ranges.length - 1 &&
      item.equals(ranges[i].high.add(Long.UONE)) &&
      item.equals(ranges[i + 1].low.subtract(Long.UONE))
    ) {
      ranges[i].high = ranges[i + 1].high;
      ranges.splice(i + 1, 1);
      return true;
    }

    // low adjacent
    if (item.equals(ranges[i].low.subtract(Long.UONE))) {
      ranges[i].low = item;
      return true;
    }

    // high adjacent
    if (item.equals(ranges[i].high.add(Long.UONE))) {
      ranges[i].high = item;
      return true;
    }

    // between ranges and non adjacent
    if (item.lessThan(ranges[i].low)) {
      ranges.splice(i, 0, {
        low: item,
        high: item,
      });
      return true;
    }
  }

  // greater than everything
  ranges.push({
    low: item,
    high: item,
  });

  return true;
}

export function subtractRange(
  left: readonly IRange[],
  right: readonly IRange[],
): IRange[] {
  const result: IRange[] = deepCopy(left);

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
        if (result[i].low.greaterThan(result[i].high)) {
          result.splice(i, 1);
        }
      } else if (range.high.greaterThanOrEqual(result[i].high)) {
        result[i].high = range.low.subtract(Long.UONE);
        if (result[i].low.greaterThan(result[i].high)) {
          result.splice(i, 1);
        }
      } else if (
        range.low.greaterThan(result[i].low) &&
        range.high.lessThan(result[i].high)
      ) {
        const current = result[i];

        const lowPart = {
          low: current.low,
          high: range.low.subtract(Long.UONE),
        };

        const highPart = {
          low: range.high.add(Long.UONE),
          high: current.high,
        };

        const fragments: IRange[] = [];
        if (lowPart.low.lessThanOrEqual(lowPart.high)) {
          fragments.push(lowPart);
        }
        if (highPart.low.lessThanOrEqual(highPart.high)) {
          fragments.push(highPart);
        }

        result.splice(i, 1, ...fragments);
      } else {
        throw Error('impossible');
      }
    }
  }

  return result;
}

export function takeRangesMaxItems(
  ranges: readonly IRange[],
  limit: Readonly<Long>,
): IRange[] {
  let sum = Long.UZERO;
  const result: IRange[] = [];

  if (limit.equals(Long.UZERO)) {
    return [];
  }

  for (const range of ranges) {
    const count = range.high.subtract(range.low).add(Long.UONE);

    const maxItems = limit.subtract(sum);

    if (maxItems.isZero()) {
      break;
    }

    if (count.lessThanOrEqual(maxItems)) {
      result.push(range);

      sum = sum.add(count);
    } else {
      result.push({
        high: range.low.add(maxItems.subtract(Long.UONE)),
        low: range.low,
      });

      break;
    }
  }

  return result;
}

export function toArray(ranges: readonly IRange[]): Long[] {
  const result = [];

  for (const range of ranges) {
    for (
      let i = range.low;
      i.lessThanOrEqual(range.high);
      i = i.add(Long.UONE)
    ) {
      result.push(i);
    }
  }

  return result;
}
