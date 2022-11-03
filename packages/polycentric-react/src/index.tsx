import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter, Routes, Route } from 'react-router-dom';
import Modal from 'react-modal';
import * as AbstractLevel from 'abstract-level';

import './index.css';
import App from './App';
import EditProfile from './EditProfile';
import Following from './Following';
import Setup from './Setup';
import Search from './Search';
import Notifications from './Notifications';
import reportWebVitals from './reportWebVitals';
import { Feed } from './Feed';
import * as Core from 'polycentric-core';
import * as Explore from './Explore';
import * as About from './About';

export * as Core from 'polycentric-core';

export async function createApp(
    level: AbstractLevel.AbstractLevel<Uint8Array, Uint8Array, Uint8Array>,
    storageDriver: Core.DB.StorageDriver,
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

    const state = new Core.DB.PolycentricState(
        level,
        storageDriver,
        clientString,
    );

    if (await Core.DB.doesIdentityExist(state)) {
        console.log(
            'navigator.storage.persist',
            await navigator.storage.persist(),
        );

        await Core.DB.startIdentity(state);
    }

    const PolycentricRoutes = () => (
        <Routes>
            <Route path="/" element={<App state={state} />}>
                <Route
                    path="/explore"
                    element={<Explore.ExploreMemo state={state} />}
                />
                <Route
                    path="/notifications"
                    element={<Notifications state={state} />}
                />
                <Route path="/" element={<Feed state={state} />} />
                <Route
                    path="/profile"
                    element={<EditProfile state={state} />}
                />
                <Route path="/search" element={<Search state={state} />} />
                <Route
                    path="/search/:search"
                    element={<Search state={state} />}
                />
                <Route
                    path="/following"
                    element={<Following state={state} />}
                />
                <Route path="/about" element={<About.About state={state} />} />
                <Route path="/setup" element={<Setup state={state} />} />
                <Route path=":feed" element={<Feed state={state} />} />
            </Route>
        </Routes>
    );

    root.render(
        <React.StrictMode>
            {isElectron ? (
                <HashRouter>
                    {' '}
                    <PolycentricRoutes />{' '}
                </HashRouter>
            ) : (
                <BrowserRouter>
                    {' '}
                    <PolycentricRoutes />{' '}
                </BrowserRouter>
            )}
        </React.StrictMode>,
    );
}

// createApp();

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
// reportWebVitals();
