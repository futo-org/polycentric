import { CancelContext, Models, Protocol, Synchronization, Util } from '@polycentric/polycentric-core'
import { forwardRef, useCallback, useEffect, useMemo, useState } from 'react'
import { useAvatar, useImageManifestDisplayURL } from '../../../hooks/imageHooks'
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks'
import {
  ParsedEvent,
  useDateFromUnixMS,
  useEventLink,
  usePostStats,
  useQueryOpinion,
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

  const reference = useMemo(() => {
    return Models.pointerToReference(pointer)
  }, [pointer])

  const opinionOnMount = useQueryOpinion(processHandle.system(), reference)
  const likedOnMount = useMemo(() => {
    if (opinionOnMount === undefined) {
      return undefined
    }
    return Util.buffersEqual(opinionOnMount, Models.Opinion.OpinionLike)
  }, [opinionOnMount])

  const [liked, setLiked] = useState<boolean>(false)
  const [locallyDisliked, setLocallyDisliked] = useState<boolean>(false)

  const updateIfLiked = useCallback(
    (cancelContext?: CancelContext.CancelContext) => {
      processHandle
        .store()
        .opinionIndex.get(processHandle.system(), reference)
        .then((result) => {
          if (cancelContext !== undefined && cancelContext.cancelled()) {
            return
          }
          setLiked(Util.buffersEqual(result, Models.Opinion.OpinionLike))
        })
    },
    [processHandle, reference],
  )

  // Initial load
  useEffect(() => {
    const cancelContext = new CancelContext.CancelContext()
    updateIfLiked(cancelContext)

    return () => {
      cancelContext.cancel()
    }
  }, [updateIfLiked])

  const like = useCallback(() => {
    processHandle
      .opinion(reference, Models.Opinion.OpinionLike)
      .then(() => {
        updateIfLiked()
        setLocallyDisliked(false)
      })
      .then(() => {
        Synchronization.backFillServers(processHandle, pointer.system)
      })
  }, [pointer, reference, processHandle, updateIfLiked])

  const unlike = useCallback(() => {
    processHandle
      .opinion(reference, Models.Opinion.OpinionNeutral)
      .then(() => {
        updateIfLiked()
        setLocallyDisliked(true)
      })
      .then(() => {
        Synchronization.backFillServers(processHandle, pointer.system)
      })
  }, [pointer, reference, processHandle, updateIfLiked])

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
      liked,
      like,
      unlike,
      comment,
      repost: () => {},
    }
  }, [liked, like, comment, unlike])

  const stats = usePostStats(pointer)

  const locallyModifiedStats: {
    likes?: number
    comments?: number
    reposts?: number
  } = useMemo(() => {
    let likes = stats.likes
    if (stats.likes === 0 && liked) {
      likes = stats.likes + 1
    } else if (liked && likedOnMount === false && stats.likes) {
      likes = stats.likes + 1
    } else if (locallyDisliked && stats.likes && stats.likes > 0) {
      likes = stats.likes - 1
    }

    return {
      ...stats,
      likes: likes,
    }
  }, [stats, liked, likedOnMount, locallyDisliked])

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

  const replyingToPointer = useMemo(() => {
    const { references } = event
    const replyingToRef = references.find((ref) => ref.referenceType.eq(2))

    if (replyingToRef) {
      const replyingToPointer = Models.Pointer.fromProto(Protocol.Pointer.decode(replyingToRef.reference))
      return replyingToPointer
    }
    return undefined
  }, [event])

  const replyingToName = useUsernameCRDTQuery(replyingToPointer?.system)
  const replyingToURL = useEventLink(replyingToPointer?.system, replyingToPointer)

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
      replyingToURL,
      content: content ?? '',
      image: imageUrl,
      topic,
      publishedAt: mainDate,
      url: mainURL,
    }),
    [
      mainUsername,
      mainAvatar,
      content,
      mainDate,
      mainURL,
      mainAuthorURL,
      mainKey,
      imageUrl,
      topic,
      replyingToName,
      replyingToURL,
    ],
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
