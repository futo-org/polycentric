import { createBrowserRouter, RouterProvider, createHashRouter } from 'react-router-dom'
import { useState, useEffect } from 'react'
import {
  PersistenceDriver,
  ProcessHandle,
  MetaStore,
  Queries,
  Models,
  Protocol,
  Util,
} from '@polycentric/polycentric-core'
import { QueryManagerContext, useCRDTQuery, useQueryManager } from '../../hooks/queryManagerHooks.js'
import { decode } from '@borderless/base64'

const decodeSystemQuery = (raw: string) => {
  return Models.URLInfo.getSystemLink(Protocol.URLInfo.decode(decode(raw)))
}

const TestPage = () => {
  const queryManager = useQueryManager()

  const [system] = useState<Models.PublicKey.PublicKey>(() => {
    const rossmannSystem = decodeSystemQuery(
      'CAESPQokCAESIML2Mw2l6bVx5d-i7aJT-Y_RQxWEwfc2agfKHjXyUwiqEhVodHRwOi8vMTI3LjAuMC4xOjgwODE',
    )
    for (const server of rossmannSystem.servers) {
      queryManager.processHandle.addAddressHint(rossmannSystem.system, server)
    }
    return rossmannSystem.system
  })

  const data = useCRDTQuery(Models.ContentType.ContentTypeUsername, system)

  if (data === undefined) {
    return <p>Loading...</p>
  }

  return <p className="bold italic">{Util.decodeText(data)}</p>
}

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
    element: <TestPage />,
  },
])

async function createProcessHandle(
  persistenceDriver: PersistenceDriver.IPersistenceDriver,
): Promise<ProcessHandle.ProcessHandle> {
  return await ProcessHandle.createProcessHandle(await MetaStore.createMetaStore(persistenceDriver))
}

export const RootApp = ({ persistenceDriver }: { persistenceDriver: PersistenceDriver.IPersistenceDriver }) => {
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
