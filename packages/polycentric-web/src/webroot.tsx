import { PersistenceDriver } from '@polycentric/polycentric-core';
import { App } from '@polycentric/polycentric-react';
import '@polycentric/polycentric-react/dist/style.css';
import { BrowserLevel } from 'browser-level';
import React from 'react';

function createPersistenceDriverIndexedDB(): PersistenceDriver.IPersistenceDriver {
    const getImplementationName = () => {
        return 'IndexedDB';
    };

    const openStore = async (path: string) => {
        const level = new BrowserLevel<Uint8Array, Uint8Array>(path, {
            keyEncoding: 'buffer',
            valueEncoding: 'buffer',
        }) as PersistenceDriver.BinaryAbstractLevel;

        await level.open();

        return level;
    };

    const estimateStorage = async () => {
        const estimate: PersistenceDriver.StorageEstimate = {
            bytesAvailable: undefined,
            bytesUsed: undefined,
        };

        try {
            const storageEstimate = await navigator.storage.estimate();

            estimate.bytesAvailable = storageEstimate.quota;

            estimate.bytesUsed = storageEstimate.usage;
        } catch (err) {
            console.warn(err);
        }

        return estimate;
    };

    const persisted = async () => {
        try {
            return await navigator.storage.persisted();
        } catch (err) {
            console.warn(err);
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

const WebRoot = () => {
    const [persistenceDriver, setPersistenceDriver] = React.useState<
        PersistenceDriver.IPersistenceDriver | undefined
    >(undefined);

    React.useEffect(() => {
        const persistenceDriver = createPersistenceDriverIndexedDB();
        setPersistenceDriver(persistenceDriver);

        console.log(persistenceDriver);
    }, []);

    if (persistenceDriver === undefined) {
        return <></>;
    }

    return <App persistenceDriver={persistenceDriver} />;
};

export default WebRoot;
