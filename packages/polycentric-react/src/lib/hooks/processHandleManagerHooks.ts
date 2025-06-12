import { decode } from '@borderless/base64';
import {
  CancelContext,
  MetaStore,
  Models,
  ProcessHandle,
  Protocol,
  Store,
} from '@polycentric/polycentric-core';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';

type BaseProcessHandleManagerHookReturn = {
  processHandle: ProcessHandle.ProcessHandle | null | undefined;
  activeStore: MetaStore.StoreInfo | null | undefined;
  stores: MetaStore.StoreInfo[];
  changeHandle: (
    account?: MetaStore.StoreInfo,
  ) => Promise<ProcessHandle.ProcessHandle | null | undefined>;
  createHandle: (
    key: Models.PrivateKey.PrivateKey,
    servers?: ReadonlyArray<string>,
    username?: string,
  ) => Promise<ProcessHandle.ProcessHandle>;
  createHandleFromExportBundle: (
    identity: string,
  ) => Promise<ProcessHandle.ProcessHandle>;
  signOut: (account?: MetaStore.StoreInfo) => Promise<void>;
  clearProcessHandle: () => Promise<void>;
  metaStore: MetaStore.IMetaStore;
  setIsNewAccount: (value: boolean) => void;
  isNewAccount: boolean;
};

interface UseProcessHandleManagerState {
  // Undefined indicates we're loading, null indicates we've checked and there's no active store
  activeStore: MetaStore.StoreInfo | null | undefined;
  processHandle: ProcessHandle.ProcessHandle | null | undefined;
}

export function useProcessHandleManagerBaseComponentHook(
  metaStore: MetaStore.IMetaStore,
): BaseProcessHandleManagerHookReturn {
  const [internalHookState, setInternalHookState] =
    useState<UseProcessHandleManagerState>({
      activeStore: undefined,
      processHandle: undefined,
    });

  const [stores, setStores] = useState<MetaStore.StoreInfo[]>([]);
  const [isNewAccount, setIsNewAccount] = useState(false);

  const changeHandle = useCallback(
    async (account?: MetaStore.StoreInfo) => {
      if (!account) {
        setInternalHookState({
          activeStore: null,
          processHandle: null,
        });
        await metaStore.unsetActiveStore();
        return undefined;
      }

      if (account) {
        const level = await metaStore.openStore(
          account.system,
          account.version,
        );
        const store = new Store.Store(level);
        const processHandle = await ProcessHandle.ProcessHandle.load(store);
        setInternalHookState({
          activeStore: account,
          processHandle,
        });
        await metaStore.setActiveStore(account.system, account.version);
        return processHandle;
      } else {
        setInternalHookState({
          activeStore: null,
          processHandle: null,
        });
        return undefined;
      }
    },
    [metaStore],
  );

  const clearProcessHandle = useCallback(async () => {
    await changeHandle(undefined);
  }, [changeHandle]);

  const createHandle = useCallback(
    async (
      privateKey: Models.PrivateKey.PrivateKey,
      servers?: ReadonlyArray<string>,
      username?: string,
    ) => {
      const processHandle = await ProcessHandle.createProcessHandleFromKey(
        metaStore,
        privateKey,
      );

      if (username) {
        await processHandle.setUsername(username);
      }

      if (servers) {
        for (const server of servers) {
          processHandle.addAddressHint(processHandle.system(), server);
          await processHandle.addServer(server);
        }
      }

      // TODO: Add proper store version numbering
      await metaStore.setActiveStore(processHandle.system(), 0);
      const activeStore = await metaStore.getActiveStore();
      setInternalHookState({
        activeStore,
        processHandle,
      });
      return processHandle;
    },
    [metaStore],
  );

  const createHandleFromExportBundle = useCallback(
    async (bundle: string) => {
      let privateKeyModel: Models.PrivateKey.PrivateKey;
      let exportBundle: Protocol.ExportBundle;

      try {
        if (bundle.startsWith('polycentric://') === false) {
          throw new Error();
        }

        const bundleWithoutPrefix = bundle.replace('polycentric://', '');
        const urlInfo = Protocol.URLInfo.decode(decode(bundleWithoutPrefix));
        exportBundle = Models.URLInfo.getExportBundle(urlInfo);

        const privateKeyBuffer: Uint8Array | undefined =
          exportBundle.keyPair?.privateKey;
        if (!privateKeyBuffer) {
          throw new Error();
        }
        const privateKeyProto = Protocol.PrivateKey.create({
          keyType: exportBundle.keyPair?.keyType,
          key: privateKeyBuffer,
        });
        privateKeyModel = Models.PrivateKey.fromProto(privateKeyProto);
      } catch (e) {
        throw new Error('Invalid identity string');
      }

      const processHandle = await ProcessHandle.createProcessHandleFromKey(
        metaStore,
        privateKeyModel,
      );

      // Ensure all events are ingested before proceeding
      if (exportBundle.events) {
        for (const event of exportBundle.events.events) {
          const eventModel = Models.SignedEvent.fromProto(event);
          await processHandle.ingest(eventModel);
        }
      }

      await metaStore.setActiveStore(processHandle.system(), 0);
      const activeStore = await metaStore.getActiveStore();
      setInternalHookState({
        activeStore,
        processHandle,
      });
      return processHandle;
    },
    [metaStore],
  );

  const signOut = useCallback(
    async (account?: MetaStore.StoreInfo) => {
      if (!internalHookState.activeStore) {
        return;
      }

      // If no account is provided, we're signing out the currently active account
      const accountToSignOut = account ?? internalHookState.activeStore;

      // If the account to sign out is the currently active account, we need to try to switch to another account
      if (
        internalHookState.activeStore &&
        Models.PublicKey.equal(
          internalHookState.activeStore?.system,
          accountToSignOut.system,
        )
      ) {
        const currentStores = await metaStore.listStores();
        const otherStores = currentStores.filter(
          (store) =>
            !Models.PublicKey.equal(store.system, accountToSignOut.system),
        );

        if (otherStores.length === 0) {
          await changeHandle(undefined);
        } else {
          await changeHandle(otherStores[0]);
        }
      }

      await metaStore.deleteStore(
        accountToSignOut.system,
        accountToSignOut.version,
      );
      const stores = await metaStore.listStores();
      setStores(stores);
    },
    [metaStore, internalHookState.activeStore, changeHandle],
  );

  useEffect(() => {
    const cancelContext = new CancelContext.CancelContext();

    metaStore.listStores().then((stores) => {
      if (cancelContext.cancelled()) return;
      setStores(stores);
    });

    metaStore.getActiveStore().then((store) => {
      if (cancelContext.cancelled()) return;
      if (store) changeHandle(store);
      else
        setInternalHookState({
          activeStore: null,
          processHandle: null,
        });
    });

    return () => {
      cancelContext.cancel();
    };
  }, [metaStore, changeHandle]);

  return {
    activeStore: internalHookState.activeStore,
    processHandle: internalHookState.processHandle,
    stores,
    changeHandle,
    createHandle,
    createHandleFromExportBundle,
    signOut,
    clearProcessHandle,
    metaStore,
    isNewAccount,
    setIsNewAccount,
  };
}

// Same type, but with the process handle guaranteed to be non-null, for use within a provider
export type ProcessHandleManagerHookReturn =
  BaseProcessHandleManagerHookReturn & {
    processHandle: ProcessHandle.ProcessHandle;
    activeStore: MetaStore.StoreInfo;
  };

// No default value once again because the hook must be used within a provider, and we enforce this below
export const BaseProcessHandleManagerContext =
  //@ts-ignore
  createContext<BaseProcessHandleManagerHookReturn>();

export function useProcessHandleManager(): ProcessHandleManagerHookReturn {
  const context = useContext(BaseProcessHandleManagerContext);
  if (
    context.processHandle === undefined ||
    context.activeStore === undefined
  ) {
    throw new Error(
      'useProcessHandleManager must be used within a ProcessHandleManagerProvider',
    );
  }
  // @ts-ignore
  return context;
}

export function useOnboardingProcessHandleManager(): BaseProcessHandleManagerHookReturn {
  // No filtering, process handle may be undefined
  return useContext(BaseProcessHandleManagerContext);
}
