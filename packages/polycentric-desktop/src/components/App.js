import '@polycentric/polycentric-react/dist/style.css';

import { app } from '@electron/remote';
import { createPersistenceDriverLevelDB } from '@polycentric/polycentric-leveldb';
import { App } from '@polycentric/polycentric-react';
import path from 'path';
import React, { useState } from 'react';

import '@fontsource-variable/public-sans/index.css';
import '@fontsource-variable/public-sans/wght-italic.css';
import '@fontsource/fragment-mono/400-italic.css';
import '@fontsource/fragment-mono/index.css';

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

    return <App persistenceDriver={persistenceDriver} />;
};

export default DesktopRoot;
