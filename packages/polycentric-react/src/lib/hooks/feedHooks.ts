import { Models, Protocol } from '@polycentric/polycentric-core'
import { ParsedEvent, useIndex } from './queryHooks'

export type FeedHookData = ParsedEvent<Protocol.Post>[]
export type FeedHookAdvanceFn = (advanceBy: number) => void

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FeedHook = (...args: any[]) => [FeedHookData, FeedHookAdvanceFn]

export const useAuthorFeed: FeedHook = (system: Models.PublicKey.PublicKey) => {
  return useIndex(system, Models.ContentType.ContentTypePost, Protocol.Post.decode)
}

export const useTopicFeed: FeedHook = (topic: string) => {
  return [[], () => topic]
}
