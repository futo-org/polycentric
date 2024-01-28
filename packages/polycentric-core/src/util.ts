const textEncoder = new TextEncoder();

export function encodeText(text: string): Uint8Array {
    return textEncoder.encode(text);
}

const textDecoder = new TextDecoder();

export function decodeText(buffer: Uint8Array): string {
    return textDecoder.decode(buffer);
}

export function buffersEqual(x: Uint8Array, y: Uint8Array): boolean {
    return compareBuffers(x, y) === 0;
}

export function bufferSuffixMatch(
    buffer: Uint8Array,
    suffix: Uint8Array,
): boolean {
    if (buffer.length < suffix.length) {
        return false;
    }

    for (let i = 0; i < suffix.byteLength; i++) {
        if (buffer[i] !== suffix[i]) {
            return false;
        }
    }

    return true;
}

export function concatBuffers(buffers: ReadonlyArray<Uint8Array>): Uint8Array {
    const result = new Uint8Array(
        buffers.reduce((acc, x) => acc + x.length, 0),
    );

    buffers.reduce((acc, x) => {
        result.set(x, acc);
        return (acc += x.length);
    }, 0);

    return result;
}

export function compareBuffers(x: Uint8Array, y: Uint8Array): number {
    if (x.length !== y.length) {
        throw Error('buffers must be same length');
    }

    for (let i = 0; i < x.byteLength; i++) {
        if (x[i] === y[i]) {
            continue;
        } else if (x[i] < y[i]) {
            return -1;
        } else {
            return 1;
        }
    }

    return 0;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function memo<Key extends object, Value>(
    cache: WeakMap<Key, Value>,
    operation: (key: Key) => Value,
    key: Key,
): Value {
    const existing = cache.get(key);

    if (existing) {
        return existing;
    } else {
        const value = operation(key);

        cache.set(key, value);

        return value;
    }
}

export function lookupWithInitial<K, V>(
    collection: Map<K, V>,
    key: K,
    makeInitial: () => V,
): V {
    const existing = collection.get(key);

    if (existing) {
        return existing;
    }

    const initial = makeInitial();

    collection.set(key, initial);

    return initial;
}

export class Box<T> {
    value: T;

    constructor(value: T) {
        this.value = value;
    }
}

export class OnceFlag {
    private _value: boolean;

    public constructor() {
        this._value = false;
    }

    public get value(): boolean {
        return this._value;
    }

    public set(): void {
        this._value = true;
    }
}

export function areMapsEqual<Key, Value>(
    a: ReadonlyMap<Key, Value>,
    b: ReadonlyMap<Key, Value>,
    equal: (a: Value, b: Value) => boolean,
): boolean {
    if (a.size !== b.size) {
        return false;
    }

    for (const [key, value] of a.entries()) {
        const otherValue = b.get(key);

        if (!otherValue) {
            return false;
        }

        if (!equal(value, otherValue)) {
            return false;
        }
    }

    return true;
}

export function mapOverMap<Key, ValueA, ValueB>(
    collection: ReadonlyMap<Key, ValueA>,
    operation: (value: ValueA) => ValueB,
): Map<Key, ValueB> {
    const result = new Map<Key, ValueB>();

    for (const [key, value] of collection.entries()) {
        result.set(key, operation(value));
    }

    return result;
}

export function mapToArray<Key, ValueT1, ValueT2>(
    map: ReadonlyMap<Key, ValueT1>,
    operation: (value: ValueT1) => ValueT2,
): Array<ValueT2> {
    const result: Array<ValueT2> = [];
    map.forEach((value) => result.push(operation(value)));
    return result;
}

export function mapToArrayKV<Key, ValueT1, ValueT2>(
    map: ReadonlyMap<Key, ValueT1>,
    operation: (key: Key, value: ValueT1) => ValueT2,
): Array<ValueT2> {
    const result: Array<ValueT2> = [];
    map.forEach((value, key) => result.push(operation(key, value)));
    return result;
}

export function splitUint8Array(
    buffer: Uint8Array,
    deliminator: number,
): Array<Uint8Array> {
    const result = [];

    let lastDeliminator = 0;

    for (let i = 0; i < buffer.length; i++) {
        if (buffer[i] === deliminator) {
            result.push(buffer.slice(lastDeliminator, i - 1));

            lastDeliminator = i;
        }
    }

    result.push(buffer.slice(lastDeliminator + 1, buffer.length));

    return result;
}
