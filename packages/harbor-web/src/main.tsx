import './tailwind.css';

import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Core from '@polycentric/polycentric-core';
import * as App from './App';

async function createProcessHandle(): Promise<Core.ProcessHandle.ProcessHandle> {
  return await Core.ProcessHandle.createProcessHandle(
    await Core.MetaStore.createMetaStore(
      Core.PersistenceDriver.createPersistenceDriverMemory(),
    ),
  );
}

async function main() {
  const processHandle = await createProcessHandle();
  const queryManager = new Core.Queries.QueryManager.QueryManager(
    processHandle,
  );

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App.App processHandle={processHandle} queryManager={queryManager} />
    </React.StrictMode>,
  );
}

main();
