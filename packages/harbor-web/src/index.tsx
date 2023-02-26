import React from 'react';
import ReactDOM from 'react-dom/client';

import * as PolycentricCore from 'polycentric-core';

import * as App from './App';

async function main() {
    const root = ReactDOM.createRoot(
        document.getElementById('root') as HTMLElement,
    );

    root.render(
        <React.StrictMode>
            <App.App/>
        </React.StrictMode>,
    );
}

main();
