import React from 'react';
import ReactDOM from 'react-dom/client';
import Modal from 'react-modal';

import './index.css';
import reportWebVitals from './reportWebVitals';
import * as Core from '@polycentric/polycentric-core';
import * as PolycentricRoutes from './Routes';

export * as Core from '@polycentric/polycentric-core';

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

export async function createErrorPage(error: string) {
    const root = ReactDOM.createRoot(
        document.getElementById('root') as HTMLElement,
    );

    root.render(
        <React.StrictMode>
            <h1
                style={{
                    position: 'fixed',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                }}
            >
                {error}
            </h1>
        </React.StrictMode>,
    );
}
