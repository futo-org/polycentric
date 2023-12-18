import { Models, Protocol, Synchronization, Util } from '@polycentric/polycentric-core'
import { forwardRef, useCallback, useMemo, useState } from 'react'
import { useAvatar, useImageManifestDisplayURL } from '../../../hooks/imageHooks'
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks'
import {
  ParsedEvent,
  useDateFromUnixMS,
  useEventLink,
  usePostStats,
  useQueryIfAdded,
  useSystemLink,
  useTextPublicKey,
  useUsernameCRDTQuery,
} from '../../../hooks/queryHooks'
import { PurePost, PurePostProps } from './PurePost'

interface PostProps {
  data: ParsedEvent<Protocol.Post> | undefined
  doesLink?: boolean
  autoExpand?: boolean
}

interface LoadedPostProps {
  data: ParsedEvent<Protocol.Post>
  doesLink?: boolean
  autoExpand?: boolean
}

const usePostStatsWithLocalActions = (pointer: Models.Pointer.Pointer) => {
  const { processHandle } = useProcessHandleManager()

  const likedStored: boolean | undefined = useQueryIfAdded(
    Models.ContentType.ContentTypeOpinion,
    processHandle.system(),
    Protocol.PublicKey.encode(pointer.system).finish(),
  )

  const [likedLocal, setLikedLocal] = useState<boolean>(false)

  const like = useCallback(async () => {
    try {
      const reference = Models.pointerToReference(pointer)
      await processHandle.opinion(reference, Models.Opinion.OpinionLike)
      await Synchronization.backFillServers(processHandle, pointer.system)
      setLikedLocal(true)
    } catch (e) {
      console.error(e)
    }
  }, [pointer, processHandle])

  const unlike = useCallback(async () => {
    try {
      const reference = Models.pointerToReference(pointer)
      await processHandle.opinion(reference, Models.Opinion.OpinionNeutral)
      await Synchronization.backFillServers(processHandle, pointer.system)
      setLikedLocal(false)
    } catch (e) {
      console.error(e)
    }
  }, [pointer, processHandle])

  const comment = useCallback(
    async (text: string) => {
      const reference = Models.pointerToReference(pointer)
      await processHandle.post(text, undefined, reference)
      try {
        await Synchronization.backFillServers(processHandle, pointer.system)
      } catch (e) {
        console.error(e)
        return false
      }
      return true
    },
    [pointer, processHandle],
  )

  const actions = useMemo(() => {
    return {
      liked: likedStored || likedLocal,
      like,
      unlike,
      comment,
      repost: () => {},
    }
  }, [likedStored, likedLocal, like, comment, unlike])

  const stats = usePostStats(pointer)

  const locallyModifiedStats: {
    likes?: number
    comments?: number
    reposts?: number
  } = useMemo(
    () => ({
      ...stats,
      likes: stats.likes === undefined ? undefined : stats.likes + (likedLocal && !likedStored ? 1 : 0),
    }),
    [stats, likedLocal, likedStored],
  )

  return {
    stats: locallyModifiedStats,
    actions,
  }
}

const LoadedPost = forwardRef<HTMLDivElement, LoadedPostProps>(({ data, doesLink, autoExpand }, ref) => {
  const { value, event, signedEvent } = data
  const { content, image } = value

  const topic = useMemo(() => {
    const { references } = event
    const topicRef = references.find((ref) => ref.referenceType.eq(3))

    if (topicRef) {
      return Util.decodeText(topicRef.reference)
    }
    return undefined
  }, [event])

  const replyingToSystem = useMemo(() => {
    const { references } = event
    const replyingToRef = references.find((ref) => ref.referenceType.eq(2))

    if (replyingToRef) {
      const replyingToPointer = Models.Pointer.fromProto(Protocol.Pointer.decode(replyingToRef.reference))
      return replyingToPointer.system
    }
    return undefined
  }, [event])

  const replyingToName = useUsernameCRDTQuery(replyingToSystem)

  const imageUrl = useImageManifestDisplayURL(event.system, image)

  const pointer = useMemo(() => Models.signedEventToPointer(signedEvent), [signedEvent])

  const mainUsername = useUsernameCRDTQuery(event.system)
  const mainAvatar = useAvatar(event.system)
  const mainKey = useTextPublicKey(event.system, 10)

  const mainDate = useDateFromUnixMS(event.unixMilliseconds)

  const mainURL = useEventLink(event.system, pointer)
  const mainAuthorURL = useSystemLink(event.system)

  const main: PurePostProps['main'] = useMemo(
    () => ({
      author: {
        name: mainUsername,
        avatarURL: mainAvatar,
        URL: mainAuthorURL,
        pubkey: mainKey,
      },
      replyingToName,
      content: content ?? '',
      image: imageUrl,
      topic,
      publishedAt: mainDate,
      url: mainURL,
    }),
    [mainUsername, mainAvatar, content, mainDate, mainURL, mainAuthorURL, mainKey, imageUrl, topic, replyingToName],
  )

  const { actions, stats } = usePostStatsWithLocalActions(pointer)

  return <PurePost ref={ref} main={main} stats={stats} actions={actions} doesLink={doesLink} autoExpand={autoExpand} />
})
LoadedPost.displayName = 'LoadedPost'

const UnloadedPost = forwardRef<HTMLDivElement>((_, ref) => {
  return <PurePost ref={ref} main={undefined} />
})
UnloadedPost.displayName = 'UnloadedPost'

export const Post = forwardRef<HTMLDivElement, PostProps>(({ data, doesLink, autoExpand }, ref) => {
  return data ? (
    <LoadedPost ref={ref} data={data} doesLink={doesLink} autoExpand={autoExpand} />
  ) : (
    <UnloadedPost ref={ref} />
  )
})

Post.displayName = 'Post'
