import { Models, Protocol, Queries } from '@polycentric/polycentric-core'
import { useMemo } from 'react'
import { ParsedEvent, useIndex, useQueryCursor, useQueryReferenceEventFeed } from './queryHooks'

export type FeedHookData = ReadonlyArray<ParsedEvent<Protocol.Post> | undefined>
export type FeedHookAdvanceFn = () => void

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FeedHook = (...args: any[]) => [FeedHookData, FeedHookAdvanceFn, boolean?]

export const useAuthorFeed: FeedHook = (system: Models.PublicKey.PublicKey) => {
  return useIndex(system, Models.ContentType.ContentTypePost, Protocol.Post.decode)
}

export const useExploreFeed: FeedHook = () => {
  const loadCallback = useMemo(() => Queries.QueryCursor.makeGetExploreCallback(), [])
  return useQueryCursor(loadCallback, Protocol.Post.decode)
}

export const useTopicFeed: FeedHook = (topic: string) => {
  return [[], () => topic]
}

export const useSearchFeed: FeedHook = (searchQuery: string) => {
  const loadCallback = useMemo(() => Queries.QueryCursor.makeGetSearchCallback(searchQuery), [searchQuery])
  const [data, advanceFn, loaded] = useQueryCursor(loadCallback, Protocol.Post.decode)

  return loaded ? [data, advanceFn] : [[undefined], advanceFn]
}

const commentFeedRequestEvents = {
  fromType: Models.ContentType.ContentTypePost,
  countLwwElementReferences: [],
  countReferences: [],
}
const emptyArray: [] = []

export const useCommentFeed = (post?: Models.SignedEvent.SignedEvent) => {
  const reference = useMemo(() => {
    if (!post) {
      return undefined
    }
    const pointer = Models.signedEventToPointer(post)
    return Models.pointerToReference(pointer)
  }, [post])

  return useQueryReferenceEventFeed(Protocol.Post.decode, reference, commentFeedRequestEvents, emptyArray, emptyArray)
}
