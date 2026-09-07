import 'react-native-get-random-values';
import { PolycentricClient } from '@polycentric/js-core';
import { PolycentricCore, setLogger } from './generated/rn/polycentric_core';
import { createReactNativeStorageDriver } from './datastore/expo-sqlite';
import { createReactNativeFileStoreDriver } from './filestore/expo-file-system';
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
  installConsoleLogger();
  const databaseName = normalizeDatabaseName(config.databaseName);

  return PolycentricClient.create({
    core: new PolycentricCore(),
    storageDriver: await createReactNativeStorageDriver(databaseName),
    filestoreDriver: await createReactNativeFileStoreDriver(
      `${databaseName}-blobs`,
    ),
    seedServers: config.seedServers,
    application: config.application,
  });
}

export { createIdentity };
export type { CreatePolycentricClientConfig };
