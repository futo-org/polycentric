import * as PersistenceDriver from './persistence-driver';

const PUBLIC_KEY = new Uint8Array(32);

describe('storeInfo', () => {
    test('encode and decode is identity', () => {
        const storeInfo: PersistenceDriver.StoreInfo = {
            publicKey: PUBLIC_KEY,
            version: 5,
            ready: false,
        };

        const encoded = PersistenceDriver.encodeStoreInfo(storeInfo);
        const decoded = PersistenceDriver.decodeStoreInfo(encoded);

        expect(decoded).toStrictEqual(storeInfo);
    });
});

describe('metaStore', () => {
    test('listStores API', async () => {
        const driver = PersistenceDriver.createPersistenceDriverMemory();
        const meta = await PersistenceDriver.createMetaStore(driver);

        const version = 6;

        expect(await meta.listStores()).toStrictEqual([]);

        await meta.openStore(PUBLIC_KEY, version);

        expect(await meta.listStores()).toStrictEqual([
            {
                publicKey: PUBLIC_KEY,
                version: 6,
                ready: false,
            },
        ]);
    });

    test('storeReady API', async () => {
        const driver = PersistenceDriver.createPersistenceDriverMemory();
        const meta = await PersistenceDriver.createMetaStore(driver);

        const version = 6;

        await meta.openStore(PUBLIC_KEY, version);

        expect(await meta.listStores()).toStrictEqual([
            {
                publicKey: PUBLIC_KEY,
                version: 6,
                ready: false,
            },
        ]);

        await meta.setStoreReady(PUBLIC_KEY, 6);

        expect(await meta.listStores()).toStrictEqual([
            {
                publicKey: PUBLIC_KEY,
                version: 6,
                ready: true,
            },
        ]);
    });

    test('activeStore API', async () => {
        const driver = PersistenceDriver.createPersistenceDriverMemory();
        const meta = await PersistenceDriver.createMetaStore(driver);

        const version = 3;

        expect(await meta.getActiveStore()).toStrictEqual(undefined);

        await meta.openStore(PUBLIC_KEY, version);
        await meta.setActiveStore(PUBLIC_KEY, version);

        expect(await meta.getActiveStore()).toStrictEqual({
            publicKey: PUBLIC_KEY,
            version: version,
            ready: false,
        });

        await meta.unsetActiveStore();

        expect(await meta.getActiveStore()).toStrictEqual(undefined);
    });
});
