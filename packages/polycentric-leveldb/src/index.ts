import * as Core from '@polycentric/polycentric-core';
import { Level } from 'level';
import * as Path from 'path';

export function createPersistenceDriverLevelDB(
    directory: string,
): Core.PersistenceDriver.IPersistenceDriver {
    const getImplementationName = () => {
        return 'LevelDB';
    };

    const openStore = async (path: string) => {
        const level = new Level<Uint8Array, Uint8Array>(
            Path.join(directory, path),
            {
                keyEncoding: Core.PersistenceDriver.deepCopyTranscoder(),
                valueEncoding: Core.PersistenceDriver.deepCopyTranscoder(),
            },
        ) as any as Core.PersistenceDriver.BinaryAbstractLevel;

        try {
            await level.open();
        } catch (e: any) {
            console.error(e);
            if (e.cause) {
                console.error('cause: ' + e.cause);
            }
        }

        return level;
    };

    const estimateStorage = async () => {
        return {
            bytesAvailable: undefined,
            bytesUsed: undefined,
        };
    };

    const persisted = async () => {
        return true;
    };

    const destroyStore = async (path: string) => {}; // todo ?

    return {
        getImplementationName,
        openStore,
        estimateStorage,
        persisted,
        destroyStore,
    };
}
