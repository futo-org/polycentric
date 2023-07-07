import { useState, useEffect, useRef, createContext, useContext } from 'react'
import { Models, Queries } from '@polycentric/polycentric-core'

// Since we create query managers based on the driver passed in, we set the query managers value at the root of the app.
// With this, it will never be undefined - but since typescript doesn't know that, we ignore the error.
// @ts-ignore
export const QueryManagerContext = createContext<Queries.QueryManager.QueryManager>()

export function useQueryManager(): Queries.QueryManager.QueryManager {
  return useContext(QueryManagerContext)
}

export function useCRDTQuery(
  contentType: Models.ContentType.ContentType,
  system: Models.PublicKey.PublicKey,
): Uint8Array | undefined {
  const [data, setData] = useState<Uint8Array | undefined>()
  const queryManager = useQueryManager()

  // Use a ref to track if the component is still mounted
  const isMounted = useRef(true)

  // A ref to track the current content type and system
  const currentParams = useRef({ contentType, system })

  useEffect(() => {
    isMounted.current = true
    return () => {
      // When the component unmounts, update the isMounted ref
      isMounted.current = false
    }
  }, [])

  useEffect(() => {
    currentParams.current = { contentType, system }

    const unregister = queryManager.queryCRDT.query(system, contentType, (buffer: Uint8Array) => {
      // Only set data if the component is still mounted and the content and system are still the same
      if (
        isMounted.current &&
        currentParams.current.contentType === contentType &&
        currentParams.current.system === system
      ) {
        setData(buffer)
      }
    })

    // Unregister when either contentType or system changes
    return () => {
      unregister()
    }
  }, [contentType, system, queryManager])

  return data
}
