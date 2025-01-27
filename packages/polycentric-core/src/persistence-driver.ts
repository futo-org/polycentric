import * as AbstractLevel from 'abstract-level';
import * as LevelTranscoder from 'level-transcoder';
import * as MemoryLevel from 'memory-level';

export type BinaryAbstractLevel = AbstractLevel.AbstractLevel<
    Uint8Array,
    Uint8Array,
    Uint8Array
>;

export type BinaryAbstractSubLevel = AbstractLevel.AbstractSublevel<
    BinaryAbstractLevel,
    Uint8Array,
    Uint8Array,
    Uint8Array
>;

export type BinaryPutLevel = AbstractLevel.AbstractBatchPutOperation<
    BinaryAbstractLevel,
    Uint8Array,
    Uint8Array
>;

export type BinaryDelLevel = AbstractLevel.AbstractBatchDelOperation<
    BinaryAbstractLevel,
    Uint8Array
>;

export type BinaryUpdateLevel = BinaryPutLevel | BinaryDelLevel;

export function deepCopyTranscoder(): LevelTranscoder.IEncoding<
    Uint8Array,
    Uint8Array,
    Uint8Array
> {
    return {
        name: 'deepCopyTranscoder',
        format: 'buffer',
        encode: (input: Uint8Array): Uint8Array => {
            const outputBuffer = new ArrayBuffer(input.length);
            const output = new Uint8Array(outputBuffer);
            output.set(input);
            return output;
        },
        decode: (buffer: Uint8Array): Uint8Array => {
            return buffer;
        },
    };
}

export async function tryLoadKey(
    table: BinaryAbstractLevel,
    key: Uint8Array,
): Promise<Uint8Array | undefined> {
    try {
        return await table.get(key);
    } catch (err) {
        return undefined;
    }
}

export interface StorageEstimate {
    bytesAvailable: number | undefined;
    bytesUsed: number | undefined;
}

export interface IPersistenceDriver {
    getImplementationName: () => string;

    openStore: (path: string) => Promise<BinaryAbstractLevel>;

    estimateStorage: (store: BinaryAbstractLevel) => Promise<StorageEstimate>;

    persisted: () => Promise<boolean>;

    destroyStore: (path: string) => Promise<void>;

    getStoreSize: (store: BinaryAbstractLevel) => Promise<number>;
}

// Add this helper function to calculate size of a single entry
function getEntrySize(key: Uint8Array, value: Uint8Array): number {
    return key.byteLength + value.byteLength;
}

// Add this function to calculate total store size
export async function calculateStoreSize(
    store: BinaryAbstractLevel,
): Promise<number> {
    let totalSize = 0;

    for await (const [key, value] of store.iterator()) {
        totalSize += getEntrySize(key, value);
    }

    return totalSize;
}

export function createPersistenceDriverMemory(): IPersistenceDriver {
    const getImplementationName = () => {
        return 'Memory';
    };

    /* eslint @typescript-eslint/require-await: 0 */
    const openStore = async () => {
        return new MemoryLevel.MemoryLevel<Uint8Array, Uint8Array>({
            keyEncoding: deepCopyTranscoder(),
            valueEncoding: deepCopyTranscoder(),
        }) as BinaryAbstractLevel;
    };

    /* eslint @typescript-eslint/require-await: 0 */
    const estimateStorage = async (store: BinaryAbstractLevel) => {
        const bytesUsed = await calculateStoreSize(store);

        return {
            bytesAvailable: undefined, // Memory storage doesn't have a fixed limit
            bytesUsed: bytesUsed,
        };
    };

    /* eslint @typescript-eslint/require-await: 0 */
    const persisted = async () => {
        return false;
    };

    /* eslint @typescript-eslint/no-empty-function: 0 */
    const destroyStore = async () => {};

    return {
        getImplementationName: getImplementationName,
        openStore: openStore,
        estimateStorage: estimateStorage,
        persisted: persisted,
        destroyStore: destroyStore,
        getStoreSize: calculateStoreSize,
    };
}
