import '@polycentric/polycentric-react/dist/style.css';
import React from 'react';
import { App } from '@polycentric/polycentric-react';
import { PersistenceDriver } from '@polycentric/polycentric-core';

const WebRoot = () => {
    const [persistenceDriver, setPersistenceDriver] = React.useState<
        PersistenceDriver.IPersistenceDriver | undefined
    >(undefined);

    React.useEffect(() => {
        const persistenceDriverMemory =
            PersistenceDriver.createPersistenceDriverMemory();
        setPersistenceDriver(persistenceDriverMemory);
    }, []);

    if (persistenceDriver === undefined) {
        return <></>;
    }

    return <App persistenceDriver={persistenceDriver} />;
};

export default WebRoot;
