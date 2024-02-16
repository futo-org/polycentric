import * as Base64 from '@borderless/base64';

import * as Util from './util';
import * as Models from './models';
import * as PersistenceDriver from './persistence-driver';
import * as Protocol from './protocol';

const ACTIVE_STORE_KEY = Util.encodeText('ACTIVE_STORE');

export interface StoreInfo {
    system: Models.PublicKey.PublicKey;
    version: number;
    ready: boolean;
}

export function storeInfoEqual(
    a: Readonly<StoreInfo>,
    b: Readonly<StoreInfo>,
): boolean {
    if (a.version !== b.version) {
        return false;
    }

    if (a.ready !== b.ready) {
        return false;
    }

    return Models.PublicKey.equal(a.system, b.system);
}

interface RawStoreInfo {
    system: string;
    version: number;
    ready: boolean;
}

export function encodeStoreInfo(storeInfo: StoreInfo): Uint8Array {
    const intermediate = {
        system: Base64.encode(
            Protocol.PublicKey.encode(storeInfo.system).finish(),
        ),
        version: storeInfo.version,
        ready: storeInfo.ready,
    };

    return Util.encodeText(JSON.stringify(intermediate));
}

export function decodeStoreInfo(buffer: Uint8Array): StoreInfo {
    const text = Util.decodeText(buffer);

    const parsed: RawStoreInfo = JSON.parse(text) as RawStoreInfo;

    return {
        system: Models.PublicKey.fromProto(
            Protocol.PublicKey.decode(Base64.decode(parsed.system)),
        ),
        version: parsed.version,
        ready: parsed.ready,
    };
}

export interface IMetaStore {
    openStore: (
        system: Models.PublicKey.PublicKey,
        version: number,
    ) => Promise<PersistenceDriver.BinaryAbstractLevel>;

    deleteStore: (
        system: Models.PublicKey.PublicKey,
        version: number,
    ) => Promise<void>;

    listStores: () => Promise<StoreInfo[]>;

    setStoreReady: (
        system: Models.PublicKey.PublicKey,
        version: number,
    ) => Promise<void>;

    setActiveStore: (
        system: Models.PublicKey.PublicKey,
        version: number,
    ) => Promise<void>;

    unsetActiveStore: () => Promise<void>;

    getActiveStore: () => Promise<StoreInfo | undefined>;
}

function makeStorePath(
    system: Models.PublicKey.PublicKey,
    version: number,
): string {
    return (
        system.keyType.toString() +
        '_' +
        Base64.encodeUrl(system.key) +
        '_' +
        version.toString()
    );
}

export async function createMetaStore(
    persistenceDriver: PersistenceDriver.IPersistenceDriver,
): Promise<IMetaStore> {
    const metaStore = await persistenceDriver.openStore('meta');

    const metaStoreStores = metaStore.sublevel('stores', {
        keyEncoding: 'buffer',
        valueEncoding: 'buffer',
    }) as PersistenceDriver.BinaryAbstractLevel;

    const openStore = async (
        system: Models.PublicKey.PublicKey,
        version: number,
    ) => {
        const pathString = makeStorePath(system, version);
        const pathBinary = Util.encodeText(pathString);

        const rawStoreInfo = await PersistenceDriver.tryLoadKey(
            metaStoreStores,
            pathBinary,
        );

        if (rawStoreInfo === undefined) {
            const storeInfo: StoreInfo = {
                system: system,
                version: version,
                ready: false,
            };

            await metaStoreStores.put(pathBinary, encodeStoreInfo(storeInfo));
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

    const setStoreReady = async (
        system: Models.PublicKey.PublicKey,
        version: number,
    ) => {
        const pathString = makeStorePath(system, version);
        const pathBinary = Util.encodeText(pathString);

        const rawStoreInfo = await PersistenceDriver.tryLoadKey(
            metaStoreStores,
            pathBinary,
        );

        if (rawStoreInfo === undefined) {
            throw new Error('store does not exist');
        }

        const storeInfo = decodeStoreInfo(rawStoreInfo);

        if (storeInfo.ready) {
            throw new Error('store was already ready');
        }

        storeInfo.ready = true;

        await metaStoreStores.put(pathBinary, encodeStoreInfo(storeInfo));
    };

    const setActiveStore = async (
        system: Models.PublicKey.PublicKey,
        version: number,
    ) => {
        const pathString = makeStorePath(system, version);
        const pathBinary = Util.encodeText(pathString);

        await metaStore.put(ACTIVE_STORE_KEY, pathBinary);
    };

    const unsetActiveStore = async () => {
        await metaStore.del(ACTIVE_STORE_KEY);
    };

    const getActiveStore = async () => {
        const activeStoreKey = await PersistenceDriver.tryLoadKey(
            metaStore,
            ACTIVE_STORE_KEY,
        );

        if (activeStoreKey === undefined) {
            return undefined;
        }

        const activeStoreInfo = await PersistenceDriver.tryLoadKey(
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

    const deleteStore = async (
        system: Models.PublicKey.PublicKey,
        version: number,
    ) => {
        const activeStore = await getActiveStore();

        const pathString = makeStorePath(system, version);
        const pathBinary = Util.encodeText(pathString);

        await metaStoreStores.del(pathBinary);
        await persistenceDriver.destroyStore(pathString);

        if (activeStore === undefined) {
            return;
        }

        if (
            activeStore.version === version &&
            Models.PublicKey.equal(system, activeStore.system)
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
