import { PersistenceDriver } from '@polycentric/polycentric-core';
import { App } from '@polycentric/polycentric-react';
import '@polycentric/polycentric-react/dist/style.css';
import { BrowserLevel } from 'browser-level';
import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

function createPersistenceDriverIndexedDB(): PersistenceDriver.IPersistenceDriver {
  const getImplementationName = () => {
    return 'IndexedDB';
  };

  const openStore = async (path: string) => {
    const level = new BrowserLevel<Uint8Array, Uint8Array>(path, {
      keyEncoding: PersistenceDriver.deepCopyTranscoder(),
      valueEncoding: PersistenceDriver.deepCopyTranscoder(),
    }) as PersistenceDriver.BinaryAbstractLevel;

    await level.open();

    return level;
  };

  const estimateStorage = async () => {
    const estimate: PersistenceDriver.StorageEstimate = {
      bytesAvailable: undefined,
      bytesUsed: undefined,
    };

    try {
      const storageEstimate = await navigator.storage.estimate();

      estimate.bytesAvailable = storageEstimate.quota;

      estimate.bytesUsed = storageEstimate.usage;
    } catch (err) {
      console.warn(err);
    }

    return estimate;
  };

  const persisted = async () => {
    try {
      return await navigator.storage.persisted();
    } catch (err) {
      console.warn(err);
    }

    return false;
  };

  const destroyStore = async (path: string) => {
    await indexedDB.deleteDatabase('level-js-' + path);
  };

  return {
    getImplementationName: getImplementationName,
    openStore: openStore,
    estimateStorage: estimateStorage,
    persisted: persisted,
    destroyStore: destroyStore,
  };
}

const ServiceWorkerUpdateButton = () => {
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [updateSW, setUpdateSW] = useState<() => Promise<void> | undefined>();
  const [pressed, setPressed] = useState(false);

  useEffect(() => {
    const updateFunction = registerSW({
      onNeedRefresh() {
        setNeedsRefresh(true);
      },
    });

    setUpdateSW(() => updateFunction);
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        width: '100%',
        top: '1rem',
        justifyContent: 'center',
        display: 'flex',
        transform: needsRefresh ? 'translateY(0)' : 'translateY(-100%)',
        transition: 'transform 2s ease-in-out',
      }}
    >
      {needsRefresh && (
        <div
          style={{
            border: '0.5px solid',
            borderColor: '#00000020',
            backgroundColor: '#FFFFFF20',
            backdropFilter: 'blur(4px)',
            borderRadius: '3rem',
            maxWidth: '100vw',
            padding: pressed ? '.95rem' : '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 1rem rgba(0, 0, 0, 0.1)',
          }}
        >
          <button
            style={{
              backgroundColor: '#60a5fa',
              color: 'white',
              fontWeight: 'bold',
              borderRadius: '2rem',
              padding: pressed ? '1.05rem' : '1rem',
              boxShadow: '0 0 1rem rgba(0, 0, 0, 0.1)',
            }}
            onMouseDown={() => setPressed(true)}
            onMouseUp={() => setPressed(false)}
            onClick={updateSW}
          >
            Update to latest version
          </button>
        </div>
      )}
    </div>
  );
};

const WebRoot = () => {
  const [persistenceDriver, setPersistenceDriver] = useState<
    PersistenceDriver.IPersistenceDriver | undefined
  >(undefined);

  useEffect(() => {
    const persistenceDriver = createPersistenceDriverIndexedDB();
    setPersistenceDriver(persistenceDriver);
  }, []);

  if (persistenceDriver === undefined) {
    return <></>;
  }

  return (
    <>
      <App persistenceDriver={persistenceDriver} />
      <ServiceWorkerUpdateButton />
    </>
  );
};

export default WebRoot;
