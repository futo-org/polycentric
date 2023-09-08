import { MetaStore, PersistenceDriver, ProcessHandle, Queries } from '@polycentric/polycentric-core'
import { useEffect, useState } from 'react'
import { RouterProvider, createBrowserRouter, createHashRouter } from 'react-router-dom'
import { FeedPage } from '../components/feed/FeedPage'
import { PureSidebarProfile } from '../components/profile/PureSidebarProfile'
import { Root } from '../components/root'
import { SearchBox } from '../components/search/searchbox'
import { QueryManagerContext } from '../hooks/queryManagerHooks.js'

// Check if we're in electron or not
const isElectron = () => {
  // window.process.type is only defined in electron
  // @ts-ignore
  return window && window.process && window.process.type
}

const createRouterFunction = isElectron() ? createHashRouter : createBrowserRouter

const router = createRouterFunction([
  {
    path: '/',
    element: <Root />,
    children: [
      {
        index: true,
        element: (
          <FeedPage>
            <>
              <SearchBox />
              <PureSidebarProfile
                profile={{
                  name: 'Rossman',
                  avatarURL: 'https://avatars.githubusercontent.com/u/1388441?v=4',
                  description: 'I like to repair. I like to repair. I like to repair.',
                }}
              />
            </>
          </FeedPage>
        ),
      },
    ],
  },
])

async function createProcessHandle(
  persistenceDriver: PersistenceDriver.IPersistenceDriver,
): Promise<ProcessHandle.ProcessHandle> {
  return await ProcessHandle.createProcessHandle(await MetaStore.createMetaStore(persistenceDriver))
}

export const App = ({ persistenceDriver }: { persistenceDriver: PersistenceDriver.IPersistenceDriver }) => {
  const [processHandle, setProcessHandle] = useState<ProcessHandle.ProcessHandle | undefined>(undefined)
  const [queryManager, setQueryManager] = useState<Queries.QueryManager.QueryManager | undefined>(undefined)
  useEffect(() => {
    createProcessHandle(persistenceDriver).then((ph) => {
      setProcessHandle(ph)
      const queryManager = new Queries.QueryManager.QueryManager(ph)
      setQueryManager(queryManager)
    })
  }, [persistenceDriver])

  if (processHandle === undefined || queryManager === undefined) {
    return <></>
  }

  return (
    <QueryManagerContext.Provider value={queryManager}>
      <RouterProvider router={router} />
    </QueryManagerContext.Provider>
  )
}
