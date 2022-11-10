import React from 'react';
import ReactDOM from 'react-dom/client';
import Modal from 'react-modal';

import './index.css';
import reportWebVitals from './reportWebVitals';
import * as Core from 'polycentric-core';
import * as PolycentricRoutes from './Routes';

export * as Core from 'polycentric-core';

export async function createApp(
    persistenceDriver: Core.PersistenceDriver.PersistenceDriver,
) {
    const root = ReactDOM.createRoot(
        document.getElementById('root') as HTMLElement,
    );

    Modal.setAppElement('#root');

    const isElectron: boolean =
        navigator.userAgent.toLowerCase().indexOf(' electron/') > -1;

    const clientString: string = (() => {
        if (isElectron) {
            return 'Desktop';
        } else {
            return 'Web';
        }
    })();

    const metaStore = await Core.PersistenceDriver.createMetaStore(
        persistenceDriver,
    );

    const activeStore = await metaStore.getActiveStore();

    let state;

    let existingProfiles = true;

    if (activeStore !== undefined) {
        const level = await metaStore.openStore(
            activeStore.publicKey,
            activeStore.version,
        );

        state = new Core.DB.PolycentricState(
            level,
            persistenceDriver,
            clientString,
        );

        await Core.DB.startIdentity(state);
    } else {
        const stores = await metaStore.listStores();

        if (stores.length === 0) {
            existingProfiles = false;
        }
    }

    root.render(
        <React.StrictMode>
            <PolycentricRoutes.PolycentricRoutesMemo
                initialState={state}
                persistenceDriver={persistenceDriver}
                metaStore={metaStore}
                isElectron={isElectron}
                existingProfiles={existingProfiles}
            />
        </React.StrictMode>,
    );
}

// createApp();

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
// reportWebVitals();
