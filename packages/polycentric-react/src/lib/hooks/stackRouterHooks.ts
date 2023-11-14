import { useMemo } from 'react'
import { matchPath, useLocation } from 'react-router-dom'
import { routeData } from '../app/router'

function getParams(url: string) {
  for (const path of Object.keys(routeData)) {
    const match = matchPath(url, { path, exact: true })
    if (match) {
      return match.params
    }
  }
  return {}
}

type emptyObject = { [key: string]: never }

export function useParams<Params extends { [K in keyof Params]?: string }>(path: string): Params | emptyObject {
  return useMemo(() => {
    return getParams(path)
  }, [path])
}

export function usePath(memoryPath?: string) {
  const location = useLocation()
  const path = useMemo(() => {
    return memoryPath ?? location.pathname
  }, [memoryPath, location.pathname])
  return path
}
