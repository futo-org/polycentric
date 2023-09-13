import { MetaStore, Models, ProcessHandle, Store } from '@polycentric/polycentric-core'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'

type BaseProcessHandleManagerHookReturn = {
  processHandle: ProcessHandle.ProcessHandle | null | undefined
  activeStore: MetaStore.StoreInfo | null | undefined
  listStores: () => Promise<MetaStore.StoreInfo[]>
  changeHandle: (account?: MetaStore.StoreInfo) => Promise<ProcessHandle.ProcessHandle | null | undefined>
  createHandle: (key: Models.PrivateKey.PrivateKey) => Promise<ProcessHandle.ProcessHandle>
  metaStore: MetaStore.IMetaStore
}

// Same type, but with the process handle guaranteed to be non-null
type ProcessHandleManagerHookReturn = {
  processHandle: ProcessHandle.ProcessHandle
  activeStore: MetaStore.StoreInfo
  listStores: () => Promise<MetaStore.StoreInfo[]>
  changeHandle: (account?: MetaStore.StoreInfo) => Promise<ProcessHandle.ProcessHandle | null | undefined>
  createHandle: (key: Models.PrivateKey.PrivateKey) => Promise<ProcessHandle.ProcessHandle>
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

      await metaStore.setActiveStore(account.system, account.version)
      const newStore = await metaStore.getActiveStore()
      if (newStore) {
        const level = await metaStore.openStore(newStore.system, newStore.version)
        const store = new Store.Store(level)
        const processHandle = await ProcessHandle.ProcessHandle.load(store)
        setInternalHookState({
          activeStore: newStore,
          processHandle,
        })
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

  const createHandle = async (privateKey: Models.PrivateKey.PrivateKey) => {
    const processHandle = await ProcessHandle.createProcessHandleFromKey(metaStore, privateKey)
    // TODO: Add proper store version numbering
    await metaStore.setActiveStore(processHandle.system(), 0)
    const activeStore = await metaStore.getActiveStore()
    setInternalHookState({
      activeStore,
      processHandle,
    })
    return processHandle
  }

  useEffect(() => {
    metaStore.getActiveStore().then((store) => {
      if (store) changeHandle(store)
      else setInternalHookState({ activeStore: null, processHandle: null })
    })
  }, [metaStore, changeHandle])

  return {
    activeStore: internalHookState.activeStore,
    processHandle: internalHookState.processHandle,
    listStores: metaStore.listStores,
    changeHandle,
    createHandle,
    metaStore,
  }
}

//@ts-ignore
export const ProcessHandleManagerContext = createContext<BaseProcessHandleManagerHookReturn>()

export function useProcessHandleManager(): ProcessHandleManagerHookReturn {
  // This hook will only be used in the main app, not onboarding
  // Therefore, we can assume that the process handle will always be non-null
  const context = useContext(ProcessHandleManagerContext)
  return context as ProcessHandleManagerHookReturn
}
