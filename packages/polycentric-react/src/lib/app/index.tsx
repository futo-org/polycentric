import { decode } from '@borderless/base64'
import { MetaStore, Models, PersistenceDriver, ProcessHandle, Protocol, Queries } from '@polycentric/polycentric-core'
import { useEffect, useState } from 'react'
import { BrowserRouter, HashRouter, Route, Switch } from 'react-router-dom'
import { QueryManagerContext } from '../hooks/queryManagerHooks'
// TODO: When everything works, change these to lazy loading
import { IonApp, IonRouterOutlet } from '@ionic/react'
import { IonReactMemoryRouter } from '@ionic/react-router'
import { createMemoryHistory } from 'history'
import { FeedPage } from '../components/feed'
import { Onboarding } from '../components/onboarding'
import { PureSidebarProfile } from '../components/profile'
import { Root } from '../components/root'
import { SearchBox } from '../components/search/searchbox'
import {
  ProcessHandleManagerContext,
  useProcessHandleManagerBaseComponentHook,
} from '../hooks/processHandleManagerHooks'

const decodeSystemQuery = (raw: string) => {
  return Models.URLInfo.getSystemLink(Protocol.URLInfo.decode(decode(raw)))
}

// Check if we're in electron or not
const isElectron = () => {
  // window.process.type is only defined in electron
  // @ts-ignore
  return window && window.process && window.process.type
}

// @ts-ignore
// navigator.standalone isn't an official api yet
const isStandalonePWA = (): boolean => window.navigator.standalone ?? false

async function createProcessHandle(
  persistenceDriver: PersistenceDriver.IPersistenceDriver,
): Promise<ProcessHandle.ProcessHandle> {
  return await ProcessHandle.createProcessHandle(await MetaStore.createMetaStore(persistenceDriver))
}

const memoryHistory = createMemoryHistory()

const PlatformRouter = ({ children }: { children: React.ReactNode }) => {
  if (isElectron()) {
    return <HashRouter>{children}</HashRouter>
  }

  if (isStandalonePWA()) {
    return (
      <IonApp>
        <IonReactMemoryRouter history={memoryHistory}>{children}</IonReactMemoryRouter>
      </IonApp>
    )
  }

  return <BrowserRouter>{children}</BrowserRouter>
}

const PlatformSwitch = ({ children }: { children: React.ReactNode }) => {
  if (isElectron() || !isStandalonePWA()) {
    return <Switch>{children}</Switch>
  }

  return <IonRouterOutlet>{children}</IonRouterOutlet>
}

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
      <PlatformRouter>
        <Root>
          <PlatformSwitch>
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
          </PlatformSwitch>
        </Root>
      </PlatformRouter>
    </QueryManagerContext.Provider>
  )
}

const OnboardingApp = () => {
  return <Onboarding />
}

const LoadedMetastoreApp = ({ metaStore }: { metaStore: MetaStore.IMetaStore }) => {
  const storeManagerProps = useProcessHandleManagerBaseComponentHook(metaStore)
  const { processHandle } = storeManagerProps

  return (
    <ProcessHandleManagerContext.Provider value={storeManagerProps}>
      {processHandle === undefined ? (
        <p>loading</p>
      ) : processHandle === null ? (
        <OnboardingApp />
      ) : (
        <SignedinApp processHandle={processHandle} />
      )}
      {/* <SignedinApp /> */}
    </ProcessHandleManagerContext.Provider>
  )
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
