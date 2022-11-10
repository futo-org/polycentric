import * as BrowserLevel from 'browser-level';

import * as PolycentricReact from 'polycentric-react';

const registerServiceWorker = async () => {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register(
                '/worker.js',
                {
                    scope: '/',
                },
            );
            if (registration.installing) {
                console.log('Service worker installing');
            } else if (registration.waiting) {
                console.log('Service worker installed');
            } else if (registration.active) {
                console.log('Service worker active');
            }
        } catch (error) {
            console.error(`Registration failed with ${error}`);
        }
    }
};

function createPersistenceDriverIndexedDB(): PolycentricReact.Core.PersistenceDriver.PersistenceDriver {
    const getImplementationName = () => {
        return 'IndexedDB';
    };

    const openStore = async (path: string) => {
        const level = new BrowserLevel.BrowserLevel<Uint8Array, Uint8Array>(
            path,
            {
                keyEncoding: 'buffer',
                valueEncoding: 'buffer',
            },
        ) as PolycentricReact.Core.PersistenceDriver.BinaryAbstractLevel;

        await level.open();

        return level;
    };

    const estimateStorage = async () => {
        const estimate: PolycentricReact.Core.PersistenceDriver.StorageEstimate =
            {
                bytesAvailable: undefined,
                bytesUsed: undefined,
            };

        try {
            const storageEstimate = await navigator.storage.estimate();

            estimate.bytesAvailable = storageEstimate.quota;

            estimate.bytesUsed = storageEstimate.usage;
        } catch (err) {
            console.log(err);
        }

        return estimate;
    };

    const persisted = async () => {
        try {
            return await navigator.storage.persisted();
        } catch (err) {
            console.log(err);
        }

        return false;
    };

    const destroyStore = async (path: string) => {
        await indexedDB.deleteDatabase('level-js-' + path);
    };

    return {
        getImplementationName: getImplementationName,
        openStore: openStore,
        estimateStorage: estimateStorage,
        persisted: persisted,
        destroyStore: destroyStore,
    };
}

async function migrateFromOldStateIfNeeded(
    meta: PolycentricReact.Core.PersistenceDriver.IMetaStore,
    persistenceDriver: PolycentricReact.Core.PersistenceDriver.PersistenceDriver,
): Promise<void> {
    const oldLevel = await persistenceDriver.openStore('PolycentricStateV5');

    const oldState = new PolycentricReact.Core.DB.PolycentricState(
        oldLevel,
        persistenceDriver,
        'browser',
    );

    let identity = undefined;

    try {
        identity = await PolycentricReact.Core.DB.levelLoadIdentity(oldState);
    } catch (err) {}

    if (identity === undefined) {
        return;
    }

    alert('Doing a migration, this may take several minutes. Click OK.');

    await meta.unsetActiveStore();

    await meta.deleteStore(
        identity.publicKey,
        PolycentricReact.Core.DB.STORAGE_VERSION,
    );

    const newLevel = await meta.openStore(
        identity.publicKey,
        PolycentricReact.Core.DB.STORAGE_VERSION,
    );

    const newState = new PolycentricReact.Core.DB.PolycentricState(
        newLevel,
        persistenceDriver,
        'browser',
    );

    await PolycentricReact.Core.Migrate.migrateCopyEvents(oldState, newState);

    await meta.setActiveStore(
        identity.publicKey,
        PolycentricReact.Core.DB.STORAGE_VERSION,
    );

    await meta.setStoreReady(
        identity.publicKey,
        PolycentricReact.Core.DB.STORAGE_VERSION,
    );

    await persistenceDriver.destroyStore('PolycentricStateV5');

    alert('migration done');
}

async function main() {
    await registerServiceWorker();

    let persistenceDriver = createPersistenceDriverIndexedDB();

    try {
        const metaStore =
            await PolycentricReact.Core.PersistenceDriver.createMetaStore(
                persistenceDriver,
            );

        await migrateFromOldStateIfNeeded(metaStore, persistenceDriver);
    } catch (err) {
        console.log('failed to open indexedb');

        persistenceDriver =
            PolycentricReact.Core.PersistenceDriver.createPersistenceDriverMemory();
    }

    PolycentricReact.createApp(persistenceDriver);
}

main();
