import '@polycentric/polycentric-react/dist/style.css';

import React, { useState } from 'react';
import { RootApp } from '@polycentric/polycentric-react';
import {
    PersistenceDriver,
    ProcessHandle,
    MetaStore,
    View,
} from '@polycentric/polycentric-core';
import { createPersistenceDriverLevelDB } from '@polycentric/polycentric-leveldb';
import path from 'path';
import { app } from '@electron/remote';

const DesktopRoot = () => {
    const [persistenceDriver, setPersistenceDriver] = useState(undefined);

    React.useEffect(() => {
        try {
            const levelDBPath = path.join(app.getPath('userData'), '/leveldb/');
            const persistenceDriverLevelDB =
                createPersistenceDriverLevelDB(levelDBPath);
            setPersistenceDriver(persistenceDriverLevelDB);
        } catch (e) {
            console.error(e);
        }
    }, []);

    if (persistenceDriver === undefined) {
        return <></>;
    }

    return <RootApp persistenceDriver={persistenceDriver} />;
};

export default DesktopRoot;
