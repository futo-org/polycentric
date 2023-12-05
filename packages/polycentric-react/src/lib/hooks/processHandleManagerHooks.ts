import { decode } from '@borderless/base64'
import { CancelContext, MetaStore, Models, ProcessHandle, Protocol, Store } from '@polycentric/polycentric-core'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

type BaseProcessHandleManagerHookReturn = {
  processHandle: ProcessHandle.ProcessHandle | null | undefined
  activeStore: MetaStore.StoreInfo | null | undefined
  stores: MetaStore.StoreInfo[]
  changeHandle: (account?: MetaStore.StoreInfo) => Promise<ProcessHandle.ProcessHandle | null | undefined>
  createHandle: (
    key: Models.PrivateKey.PrivateKey,
    servers?: ReadonlyArray<string>,
    username?: string,
  ) => Promise<ProcessHandle.ProcessHandle>
  createHandleFromExportBundle: (identity: string) => Promise<ProcessHandle.ProcessHandle>
  signOutOtherUser: (account: MetaStore.StoreInfo) => Promise<void>
  metaStore: MetaStore.IMetaStore
}

interface UseProcessHandleManagerState {
  // Undefined indicates we're loading, null indicates we've checked and there's no active store
  activeStore: MetaStore.StoreInfo | null | undefined
  processHandle: ProcessHandle.ProcessHandle | null | undefined
}

export function useProcessHandleManagerBaseComponentHook(
  metaStore: MetaStore.IMetaStore,
): BaseProcessHandleManagerHookReturn {
  const [internalHookState, setInternalHookState] = useState<UseProcessHandleManagerState>({
    activeStore: undefined,
    processHandle: undefined,
  })

  const [stores, setStores] = useState<MetaStore.StoreInfo[]>([])

  const changeHandle = useCallback(
    async (account?: MetaStore.StoreInfo) => {
      if (!account) {
        setInternalHookState({
          activeStore: null,
          processHandle: null,
        })
        await metaStore.unsetActiveStore()
        return undefined
      }

      if (account) {
        const level = await metaStore.openStore(account.system, account.version)
        const store = new Store.Store(level)
        const processHandle = await ProcessHandle.ProcessHandle.load(store)
        setInternalHookState({
          activeStore: account,
          processHandle,
        })
        await metaStore.setActiveStore(account.system, account.version)
        return processHandle
      } else {
        setInternalHookState({
          activeStore: null,
          processHandle: null,
        })
        return undefined
      }
    },
    [metaStore],
  )

  const createHandle = useCallback(
    async (privateKey: Models.PrivateKey.PrivateKey, servers?: ReadonlyArray<string>, username?: string) => {
      const processHandle = await ProcessHandle.createProcessHandleFromKey(metaStore, privateKey)

      if (username) {
        await processHandle.setUsername(username)
      }

      if (servers) {
        await Promise.all(
          servers?.map((server) => {
            processHandle.addAddressHint(processHandle.system(), server)
            processHandle.addServer(server)
          }),
        )
      }

      // TODO: Add proper store version numbering
      await metaStore.setActiveStore(processHandle.system(), 0)
      const activeStore = await metaStore.getActiveStore()
      setInternalHookState({
        activeStore,
        processHandle,
      })
      return processHandle
    },
    [metaStore],
  )

  const createHandleFromExportBundle = useCallback(
    async (bundle: string) => {
      let privateKeyModel: Models.PrivateKey.PrivateKey
      let exportBundle: Protocol.ExportBundle

      try {
        if (bundle.startsWith('polycentric://') === false) {
          throw new Error()
        }

        const bundleWithoutPrefix = bundle.replace('polycentric://', '')
        const urlInfo = Protocol.URLInfo.decode(decode(bundleWithoutPrefix))
        exportBundle = Models.URLInfo.getExportBundle(urlInfo)

        const privateKeyBuffer: Uint8Array | undefined = exportBundle.keyPair?.privateKey
        if (!privateKeyBuffer) {
          throw new Error()
        }
        const privateKeyProto = Protocol.PrivateKey.create({
          keyType: exportBundle.keyPair?.keyType,
          key: privateKeyBuffer,
        })
        privateKeyModel = Models.PrivateKey.fromProto(privateKeyProto)
      } catch (e) {
        throw new Error('Invalid identity string')
      }

      const processHandle = await ProcessHandle.createProcessHandleFromKey(metaStore, privateKeyModel)

      if (exportBundle.events) {
        await Promise.all(
          exportBundle.events.events.map((event) => {
            const eventModel = Models.SignedEvent.fromProto(event)
            return processHandle.ingest(eventModel)
          }),
        )
      }

      await metaStore.setActiveStore(processHandle.system(), 0)
      const activeStore = await metaStore.getActiveStore()
      setInternalHookState({
        activeStore,
        processHandle,
      })
      return processHandle
    },
    [metaStore],
  )

  const signOutOtherUser = useCallback(
    async (account: MetaStore.StoreInfo) => {
      if (
        internalHookState.activeStore &&
        Models.PublicKey.equal(internalHookState.activeStore?.system, account.system)
      ) {
        throw new Error('Cannot sign out the currently active user. Prompt the user to switch accounts instead.')
      }
      await metaStore.deleteStore(account.system, account.version)
      const stores = await metaStore.listStores()
      setStores(stores)
    },
    [metaStore, internalHookState.activeStore],
  )

  useEffect(() => {
    const cancelContext = new CancelContext.CancelContext()

    metaStore.listStores().then((stores) => {
      if (cancelContext.cancelled()) return
      setStores(stores)
    })

    metaStore.getActiveStore().then((store) => {
      if (cancelContext.cancelled()) return
      if (store) changeHandle(store)
      else setInternalHookState({ activeStore: null, processHandle: null })
    })

    return () => {
      cancelContext.cancel()
    }
  }, [metaStore, changeHandle])

  return {
    activeStore: internalHookState.activeStore,
    processHandle: internalHookState.processHandle,
    stores,
    changeHandle,
    createHandle,
    createHandleFromExportBundle,
    signOutOtherUser,
    metaStore,
  }
}

// Same type, but with the process handle guaranteed to be non-null, for use within a provider
export type ProcessHandleManagerHookReturn = BaseProcessHandleManagerHookReturn & {
  processHandle: ProcessHandle.ProcessHandle
  activeStore: MetaStore.StoreInfo
}

//@ts-ignore
// No default value once again because the hook must be used within a provider, and we enforce this below
export const ProcessHandleManagerContext = createContext<ProcessHandleManagerHookReturn>()

export function useProcessHandleManager(): ProcessHandleManagerHookReturn {
  const context = useContext(ProcessHandleManagerContext)
  if (context.processHandle === undefined || context.activeStore === undefined) {
    throw new Error('useProcessHandleManager must be used within a ProcessHandleManagerProvider')
  }
  return context
}

//@ts-ignore
export const OnboardingProcessHandleManagerContext = createContext<BaseProcessHandleManagerHookReturn>()

export function useOnboardingProcessHandleManager(): BaseProcessHandleManagerHookReturn {
  return useContext(OnboardingProcessHandleManagerContext)
}
