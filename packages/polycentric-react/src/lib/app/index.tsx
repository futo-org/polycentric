import { IonApp, IonRouterOutlet } from '@ionic/react'
import { IonReactHashRouter, IonReactMemoryRouter, IonReactRouter } from '@ionic/react-router'
import { MetaStore, PersistenceDriver, ProcessHandle, Queries } from '@polycentric/polycentric-core'
import { createMemoryHistory } from 'history'
import { useEffect, useState } from 'react'
import { Route } from 'react-router-dom'
import { FeedPage } from '../components/feed'
import { Onboarding } from '../components/onboarding'
import { PureSidebarProfile } from '../components/profile'
import { RootLayout } from '../components/rootlayout'
import { SearchBox } from '../components/search/searchbox'
import {
  OnboardingProcessHandleManagerContext,
  ProcessHandleManagerContext,
  useProcessHandleManagerBaseComponentHook,
} from '../hooks/processHandleManagerHooks'
import { QueryManagerContext } from '../hooks/queryHooks'

// Check if we're in electron or not
const isElectron = () => {
  // window.process.type is only defined in electron
  // @ts-ignore
  return window && window.process && window.process.type
}

// @ts-ignore
// navigator.standalone isn't an official api yet
const isStandalonePWA = (): boolean => window.navigator.standalone ?? false

const memoryHistory = createMemoryHistory()

const PlatformRouter = ({ children }: { children: React.ReactNode }) => {
  if (isElectron()) {
    return <IonReactHashRouter>{children}</IonReactHashRouter>
  }

  if (isStandalonePWA()) {
    return <IonReactMemoryRouter history={memoryHistory}>{children}</IonReactMemoryRouter>
  }

  return <IonReactRouter>{children}</IonReactRouter>
}

const AppRouter = () => (
  <>
    <Route path="/">
      <FeedPage>
        <div className="p-5">
          <SearchBox />
          <PureSidebarProfile
            profile={{
              name: 'Rossman',
              avatarURL: 'https://avatars.githubusercontent.com/u/1388441?v=4',
              description: 'I like to repair. I like to repair. I like to repair.',
            }}
          />
        </div>
      </FeedPage>
    </Route>
  </>
)

// Currently, Polycentric can only be used while signed in
export const SignedinApp = ({ processHandle }: { processHandle: ProcessHandle.ProcessHandle }) => {
  const [queryManager, setQueryManager] = useState<Queries.QueryManager.QueryManager>(
    () => new Queries.QueryManager.QueryManager(processHandle),
  )

  useEffect(() => {
    setQueryManager(new Queries.QueryManager.QueryManager(processHandle))
  }, [processHandle])

  return (
    <QueryManagerContext.Provider value={queryManager}>
      <IonApp>
        <PlatformRouter>
          <RootLayout>
            <IonRouterOutlet>
              <AppRouter />
            </IonRouterOutlet>
          </RootLayout>
        </PlatformRouter>
      </IonApp>
    </QueryManagerContext.Provider>
  )
}

const LoadedMetastoreApp = ({ metaStore }: { metaStore: MetaStore.IMetaStore }) => {
  const storeManagerProps = useProcessHandleManagerBaseComponentHook(metaStore)

  const { processHandle, activeStore } = storeManagerProps

  if (processHandle === undefined || activeStore === undefined) {
    return <p>loading</p>
  } else if (processHandle === null || activeStore === null) {
    return (
      <OnboardingProcessHandleManagerContext.Provider value={storeManagerProps}>
        <Onboarding />
      </OnboardingProcessHandleManagerContext.Provider>
    )
  } else {
    // Typescript is dumb and doesn't understand that we've already checked for null
    const contextProps = { ...storeManagerProps, processHandle, activeStore }
    return (
      <ProcessHandleManagerContext.Provider value={contextProps}>
        <SignedinApp processHandle={processHandle} />
      </ProcessHandleManagerContext.Provider>
    )
  }
}

export const App = ({ persistenceDriver }: { persistenceDriver: PersistenceDriver.IPersistenceDriver }) => {
  const [metaStore, setMetaStore] = useState<MetaStore.IMetaStore>()

  useEffect(() => {
    MetaStore.createMetaStore(persistenceDriver).then((metaStore) => setMetaStore(metaStore))
  }, [persistenceDriver])

  if (metaStore === undefined) {
    return <p>Loading...</p>
  }

  return <LoadedMetastoreApp metaStore={metaStore} />
}
