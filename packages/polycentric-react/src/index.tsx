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
import Explore from './Explore';
import reportWebVitals from './reportWebVitals';
import { Feed } from './Feed';
import * as Core from 'polycentric-core';

/*
async function createDB(name: string) {
    try {
        const db = new DB.PolycentricDatabase(name, false);
        await db.open();
        return db;
    } catch (err) {
        alert('Failed to setup IndexedDB, using memory fallback');
        console.log(err);
        return new DB.PolycentricDatabase(name, true);
    }
}
*/

export async function createApp(
    level: AbstractLevel.AbstractLevel<Uint8Array, Uint8Array, Uint8Array>,
) {
    console.log(
        'navigator.storage.persisted',
        await navigator.storage.persisted(),
    );

    console.log(
        'navigator.storage.persistent',
        await navigator.storage.persist(),
    );

    try {
        const storageEstimate = await navigator.storage.estimate();
        console.log(storageEstimate);
        console.log('storage available', storageEstimate.quota! / 1024 / 1024);
        console.log('storage usage', storageEstimate.usage! / 1024 / 1024);
    } catch (err) {
        console.log('storage info error', err);
    }

    const root = ReactDOM.createRoot(
        document.getElementById('root') as HTMLElement,
    );

    Modal.setAppElement('#root');

    const state = new Core.DB.PolycentricState(level);

    if (await Core.DB.doesIdentityExist(state)) {
        await Core.DB.startIdentity(state);
    }

    const isElectron =
        navigator.userAgent.toLowerCase().indexOf(' electron/') > -1;

    const PolycentricRoutes = () => (
        <Routes>
            <Route path="/" element={<App state={state} />}>
                <Route path="/explore" element={<Explore state={state} />} />
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
