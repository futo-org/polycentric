export * as Version from './version';
export * as Models from './models';
export * as PersistenceDriver from './persistence-driver';
export * as MetaStore from './meta-store';
export * as Store from './store';
export * as ProcessHandle from './process-handle';
export * as Ranges from './ranges';
export * as APIMethods from './api-methods';
export * as Synchronization from './synchronization';
export * as Protocol from './protocol';
export * as CancelContext from './cancel-context';
export * as Util from './util';
export * as Queries from './queries';

// Default export for React Native specific functionality
import { createPersistenceDriverReactNative } from './persistence-driver';
import { createMetaStore } from './meta-store';
import { createProcessHandle } from './process-handle';

// Helper function to create a process handle with React Native persistence
export const createRNProcessHandle = async () => {
  const persistenceDriver = createPersistenceDriverReactNative();
  const metaStore = await createMetaStore(persistenceDriver);
  return await createProcessHandle(metaStore);
};
