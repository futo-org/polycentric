import * as AbstractLevel from 'abstract-level';
import * as MemoryLevel from 'memory-level';
import * as Base64 from '@borderless/base64';

import * as Util from './Util';
import * as DB from './db';

export type BinaryAbstractLevel = AbstractLevel.AbstractLevel<
    Uint8Array,
    Uint8Array,
    Uint8Array
>;

export type StorageEstimate = {
    bytesAvailable: number | undefined;
    bytesUsed: number | undefined;
};

export interface PersistenceDriver {
    getImplementationName: () => string;

    openStore: (path: string) => Promise<BinaryAbstractLevel>;

    estimateStorage: () => Promise<StorageEstimate>;

    persisted: () => Promise<boolean>;

    destroyStore: (path: string) => Promise<void>;
}

export function createPersistenceDriverMemory(): PersistenceDriver {
    const getImplementationName = () => {
        return 'Memory';
    };

    const openStore = async (path: string) => {
        return new MemoryLevel.MemoryLevel<Uint8Array, Uint8Array>({
            keyEncoding: 'buffer',
            valueEncoding: 'buffer',
        }) as BinaryAbstractLevel;
    };

    const estimateStorage = async () => {
        return {
            bytesAvailable: undefined,
            bytesUsed: undefined,
        };
    };

    const persisted = async () => {
        return false;
    };

    const destroyStore = async (path: string) => {};

    return {
        getImplementationName: getImplementationName,
        openStore: openStore,
        estimateStorage: estimateStorage,
        persisted: persisted,
        destroyStore: destroyStore,
    };
}

export type StoreInfo = {
    publicKey: Uint8Array;
    version: number;
    ready: boolean;
};

export function encodeStoreInfo(storeInfo: StoreInfo): Uint8Array {
    const intermediate = {
        publicKey: Base64.encode(storeInfo.publicKey),
        version: storeInfo.version,
        ready: storeInfo.ready,
    };

    return new TextEncoder().encode(JSON.stringify(intermediate));
}

export function decodeStoreInfo(buffer: Uint8Array): StoreInfo {
    const text = new TextDecoder().decode(buffer);

    const parsed = JSON.parse(text);

    return {
        publicKey: Base64.decode(parsed.publicKey),
        version: parsed.version,
        ready: parsed.ready,
    };
}

export interface IMetaStore {
    openStore: (
        publicKey: Uint8Array,
        version: number,
    ) => Promise<BinaryAbstractLevel>;

    deleteStore: (publicKey: Uint8Array, version: number) => Promise<void>;

    listStores: () => Promise<Array<StoreInfo>>;

    setStoreReady: (publicKey: Uint8Array, version: number) => Promise<void>;

    setActiveStore: (publicKey: Uint8Array, version: number) => Promise<void>;

    unsetActiveStore: () => Promise<void>;

    getActiveStore: () => Promise<StoreInfo | undefined>;
}

function makeStorePath(publicKey: Uint8Array, version: number): string {
    return Base64.encode(publicKey) + '_' + version.toString();
}

const ACTIVE_STORE_KEY = new TextEncoder().encode('ACTIVE_STORE');

export async function createMetaStore(
    persistenceDriver: PersistenceDriver,
): Promise<IMetaStore> {
    const metaStore = await persistenceDriver.openStore('meta');

    const metaStoreStores = metaStore.sublevel('stores', {
        keyEncoding: 'buffer',
        valueEncoding: 'buffer',
    }) as BinaryAbstractLevel;

    const openStore = async (publicKey: Uint8Array, version: number) => {
        const encoder = new TextEncoder();

        const pathString = makeStorePath(publicKey, version);
        const pathBinary = encoder.encode(pathString);

        const rawStoreInfo = await DB.tryLoadKey(metaStoreStores, pathBinary);

        if (rawStoreInfo === undefined) {
            const storeInfo: StoreInfo = {
                publicKey: publicKey,
                version: version,
                ready: false,
            };

            metaStoreStores.put(pathBinary, encodeStoreInfo(storeInfo));
        }

        const store = await persistenceDriver.openStore(pathString);

        return store;
    };

    const listStores = async () => {
        const all = await metaStoreStores.values().all();

        const result = [];

        for (const item of all) {
            result.push(decodeStoreInfo(item));
        }

        return result;
    };

    const setStoreReady = async (publicKey: Uint8Array, version: number) => {
        const encoder = new TextEncoder();

        const pathString = makeStorePath(publicKey, version);
        const pathBinary = encoder.encode(pathString);

        const rawStoreInfo = await DB.tryLoadKey(metaStoreStores, pathBinary);

        if (rawStoreInfo === undefined) {
            throw new Error('store does not exist');
        }

        const storeInfo = decodeStoreInfo(rawStoreInfo);

        if (storeInfo.ready === true) {
            throw new Error('store was already ready');
        }

        storeInfo.ready = true;

        await metaStoreStores.put(pathBinary, encodeStoreInfo(storeInfo));
    };

    const setActiveStore = async (publicKey: Uint8Array, version: number) => {
        const encoder = new TextEncoder();

        const pathString = makeStorePath(publicKey, version);
        const pathBinary = encoder.encode(pathString);

        await metaStore.put(ACTIVE_STORE_KEY, pathBinary);
    };

    const unsetActiveStore = async () => {
        await metaStore.del(ACTIVE_STORE_KEY);
    };

    const getActiveStore = async () => {
        const activeStoreKey = await DB.tryLoadKey(metaStore, ACTIVE_STORE_KEY);

        if (activeStoreKey === undefined) {
            return undefined;
        }

        const activeStoreInfo = await DB.tryLoadKey(
            metaStoreStores,
            activeStoreKey,
        );

        if (activeStoreInfo !== undefined) {
            return decodeStoreInfo(activeStoreInfo);
        } else {
            throw new Error(
                'active store was set but active store does not exist',
            );
        }
    };

    const deleteStore = async (publicKey: Uint8Array, version: number) => {
        const encoder = new TextEncoder();

        const pathString = makeStorePath(publicKey, version);
        const pathBinary = encoder.encode(pathString);

        await metaStoreStores.del(pathBinary);
        await persistenceDriver.destroyStore(pathString);

        const activeStore = await getActiveStore();

        if (activeStore === undefined) {
            return;
        }

        if (
            activeStore.version === version &&
            Util.blobsEqual(publicKey, activeStore.publicKey) === true
        ) {
            await unsetActiveStore();
        }
    };

    return {
        openStore: openStore,
        listStores: listStores,
        setStoreReady: setStoreReady,
        setActiveStore: setActiveStore,
        unsetActiveStore: unsetActiveStore,
        getActiveStore: getActiveStore,
        deleteStore: deleteStore,
    };
}
