import * as BrowserLevel from 'browser-level';

import * as PolycentricReact from 'polycentric-react';

const registerServiceWorker = async () => {
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

async function main() {
    if (('serviceWorker' in navigator) === false) {
        PolycentricReact.createErrorPage(
            'Your browser does not support Service Workers'
        );

        return;
    }

    await registerServiceWorker();

    let persistenceDriver = createPersistenceDriverIndexedDB();

    try {
        const metaStore =
            await PolycentricReact.Core.PersistenceDriver.createMetaStore(
                persistenceDriver,
            );
    } catch (err) {
        PolycentricReact.createErrorPage(
            'Your browser does not support IndexedDB'
        );

        return;
    }

    PolycentricReact.createApp(persistenceDriver);
}

main();
