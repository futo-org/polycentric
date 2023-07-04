import "@polycentric/polycentric-react/dist/style.css"
import React from 'react'
import ReactDOM from 'react-dom/client'
import { RootApp } from "@polycentric/polycentric-react2"
import { PersistenceDriver, ProcessHandle, MetaStore, View } from '@polycentric/polycentric-core';

async function createProcessHandle(): Promise<ProcessHandle.ProcessHandle> {
  return await ProcessHandle.createProcessHandle(
    await MetaStore.createMetaStore(
      PersistenceDriver.createPersistenceDriverMemory(),
    ),
  );
}

const WebRoot = () => {
  const [persistenceDriver, setPersistenceDriver] = React.useState<PersistenceDriver.IPersistenceDriver | undefined>(undefined);

  React.useEffect(() => {
    const persistenceDriverMemory = PersistenceDriver.createPersistenceDriverMemory();
    setPersistenceDriver(persistenceDriverMemory);
  }, []);

  if (persistenceDriver === undefined) {
    return (<></>);
  }

  return (
    <RootApp persistenceDriver={persistenceDriver} />

  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <WebRoot />
  </React.StrictMode>,
)
