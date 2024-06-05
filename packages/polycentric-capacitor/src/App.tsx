import { MobileLevel } from '@polycentric/leveldb-capacitor-plugin';
import { PersistenceDriver } from '@polycentric/polycentric-core';
import { App } from '@polycentric/polycentric-react';
import '@polycentric/polycentric-react/dist/style.css';
import { useEffect, useState } from 'react';
import './capacitor.css';

class MobileLevelDBPersistenceDriver {
    levels = new Map<string, PersistenceDriver.BinaryAbstractLevel>();

    getImplementationName = () => {
        return 'MobileLevelDB';
    };

    openStore = async (path: string) => {
        const level = new MobileLevel(path, {
            keyEncoding: 'view',
            valueEncoding: 'view',
        });

        await level.open().catch((err) => {
            console.error(err);
        });

        // assign level to the class level
        this.levels.set(path, level);

        return level;
    };

    estimateStorage = async () => {
        const estimate: PersistenceDriver.StorageEstimate = {
            bytesAvailable: undefined,
            bytesUsed: undefined,
        };

        // TODO: this
        // try {
        //     const storageEstimate = await navigator.storage.estimate();

        //     estimate.bytesAvailable = storageEstimate.quota;

        //     estimate.bytesUsed = storageEstimate.usage;
        // } catch (err) {
        //     console.warn(err);
        // }

        return estimate;
    };

    persisted = async () => {
        return true;
    };

    destroyStore = async (path: string) => {
        await indexedDB.deleteDatabase('level-js-' + path);
    };

    async close(path: string) {
        const level = this.levels.get(path);

        if (level !== undefined) {
            await level.close();
        }
    }

    async closeAll() {
        for (const path of this.levels.keys()) {
            await this.close(path);
        }
    }
}

export const AppRoot = () => {
    const [persistenceDriver, setPersistenceDriver] = useState<
        PersistenceDriver.IPersistenceDriver | undefined
    >(undefined);

    useEffect(() => {
        const persistenceDriver = new MobileLevelDBPersistenceDriver();
        setPersistenceDriver(persistenceDriver);

        return () => {
            persistenceDriver.closeAll();
        };
    }, []);

    if (persistenceDriver === undefined) {
        return <></>;
    }

    return <App persistenceDriver={persistenceDriver} />;
};
