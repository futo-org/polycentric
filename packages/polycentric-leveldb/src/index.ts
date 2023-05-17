import * as Path from 'path';
import * as AbstractLevel from 'abstract-level';
import * as ClassicLevel from 'classic-level';

import * as Core from '@polycentric/polycentric-core';

export function createPersistenceDriverLevelDB(
    directory: string,
): Core.PersistenceDriver.IPersistenceDriver {
    const getImplementationName = () => {
        return 'LevelDB';
    };

    const openStore = async (path: string) => {
        const level = new ClassicLevel.ClassicLevel<Uint8Array, Uint8Array>(
            Path.join(directory, path),
            {
                keyEncoding: 'buffer',
                valueEncoding: 'buffer',
            },
        ) as any as Core.PersistenceDriver.BinaryAbstractLevel;

        await level.open();

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

    const destroyStore = async (path: string) => {};

    return {
        getImplementationName: getImplementationName,
        openStore: openStore,
        estimateStorage: estimateStorage,
        persisted: persisted,
        destroyStore: destroyStore,
    };
}


