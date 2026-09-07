import {
  MemoryFileStoreDriver,
  MemoryStorageDriver,
  PolycentricClient,
} from '@polycentric/js-core';
import {
  IndexedDBStorageDriver,
  OpfsFileStoreDriver,
} from '@polycentric/js-browser';
import {
  PolycentricCore,
  setLogger,
  uniffiInitAsync,
} from '@polycentric/rs-core-wasm/web';
import {
  createBatchingLogSink,
  createIdentity,
  normalizeDatabaseName,
  type CreatePolycentricClientConfig,
} from './create-polycentric-client.shared';

let loggerInstalled = false;
function installConsoleLogger() {
  if (loggerInstalled) return;
  loggerInstalled = true;
  setLogger(createBatchingLogSink());
}

export async function createPolycentricClient(
  config: CreatePolycentricClientConfig = {},
): Promise<PolycentricClient> {
  const databaseName = normalizeDatabaseName(config.databaseName);

  // Load + initialize the wasm module before constructing the core.
  await uniffiInitAsync();
  installConsoleLogger();

  // Private browsing can block IndexedDB/OPFS entirely; fall back to
  // in-memory storage so the app still runs (logged-out, nothing persists).
  let drivers: Pick<
    Parameters<typeof PolycentricClient.create>[0],
    'storageDriver' | 'filestoreDriver' | 'persistentStorage'
  >;
  try {
    drivers = {
      storageDriver: await IndexedDBStorageDriver.create(databaseName),
      filestoreDriver: await OpfsFileStoreDriver.create(
        `${databaseName}-blobs`,
      ),
      persistentStorage: true,
    };
  } catch (error) {
    console.warn('Persistent storage unavailable, running in-memory:', error);
    drivers = {
      storageDriver: new MemoryStorageDriver(),
      filestoreDriver: new MemoryFileStoreDriver(),
      persistentStorage: false,
    };
  }

  return PolycentricClient.create({
    core: new PolycentricCore(),
    ...drivers,
    seedServers: config.seedServers,
    application: config.application,
  });
}

export { createIdentity };
export type { CreatePolycentricClientConfig };
