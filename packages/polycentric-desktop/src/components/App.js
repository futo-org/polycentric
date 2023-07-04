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

const WebRoot = () => {
    const [persistenceDriver, setPersistenceDriver] = useState(undefined);

    React.useEffect(() => {
        const persistenceDriverLevelDB = createPersistenceDriverLevelDB("./db/");
        setPersistenceDriver(persistenceDriverLevelDB);
    }, []);

    if (persistenceDriver === undefined) {
        return <></>;
    }

    return <RootApp persistenceDriver={persistenceDriver} />;
};

export default WebRoot;
