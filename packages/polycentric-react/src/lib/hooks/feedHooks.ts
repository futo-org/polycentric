import { Models, Protocol, Queries } from '@polycentric/polycentric-core'
import { useCallback } from 'react'
import { ParsedEvent, useIndex, useQueryCursor } from './queryHooks'

export type FeedHookData = ParsedEvent<Protocol.Post>[]
export type FeedHookAdvanceFn = () => void

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FeedHook = (...args: any[]) => [FeedHookData, FeedHookAdvanceFn]

export const useAuthorFeed: FeedHook = (system: Models.PublicKey.PublicKey) => {
  return useIndex(system, Models.ContentType.ContentTypePost, Protocol.Post.decode)
}

export const useExploreFeed: FeedHook = () => {
  const loadCallback = useCallback(Queries.QueryCursor.makeGetExploreCallback(), [])
  return useQueryCursor(loadCallback, Protocol.Post.decode)
}

export const useTopicFeed: FeedHook = (topic: string) => {
  return [[], () => topic]
}

export const useSearchFeed: FeedHook = (searchQuery: string) => {
  const loadCallback = useCallback(Queries.QueryCursor.makeGetSearchCallback(searchQuery), [searchQuery])
  return useQueryCursor(loadCallback, Protocol.Post.decode)
}
