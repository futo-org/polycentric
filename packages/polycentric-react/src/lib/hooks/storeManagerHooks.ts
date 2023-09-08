import { createContext, useContext, useEffect, useState } from 'react'
import { MetaStore } from '@polycentric/polycentric-core'

type StoreManagerHookReturn = {
  activeStore: MetaStore.StoreInfo | undefined
  listStores: () => Promise<MetaStore.StoreInfo[]>
  changeAccount: (account: MetaStore.StoreInfo) => void
  metaStore: MetaStore.IMetaStore
}

export function useStoreManagerBaseComponent(metaStore: MetaStore.IMetaStore): StoreManagerHookReturn {
  const [activeStore, setActiveStore] = useState<MetaStore.StoreInfo | undefined>()

  useEffect(() => {
    metaStore.getActiveStore().then((store) => {
      setActiveStore(store)
    })
  }, [metaStore])

  const changeAccount = async (account: MetaStore.StoreInfo) => {
    await metaStore.setActiveStore(account.system, account.version)
    const newStore = await metaStore.getActiveStore()
    setActiveStore(newStore)
  }

  return {
    activeStore,
    listStores: metaStore.listStores,
    changeAccount,
    metaStore,
  }
}

//@ts-ignore
export const StoreManagerContext = createContext<StoreManagerHookReturn>()

export function useStoreManager(): StoreManagerHookReturn {
  return useContext(StoreManagerContext)
}
