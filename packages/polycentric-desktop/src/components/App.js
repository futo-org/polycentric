import '@polycentric/polycentric-react/dist/style.css';

import { app } from '@electron/remote';
import { createPersistenceDriverLevelDB } from '@polycentric/polycentric-leveldb';
import { Root } from '@polycentric/polycentric-react';
import path from 'path';
import React, { useState } from 'react';

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

    return <Root persistenceDriver={persistenceDriver} />;
};

export default DesktopRoot;
