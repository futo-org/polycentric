import { Models, Protocol, Synchronization } from '@polycentric/polycentric-core'
import { forwardRef, useCallback, useMemo, useState } from 'react'
import { useProcessHandleManager } from '../../../hooks/processHandleManagerHooks'
import {
  ParsedEvent,
  useAvatar,
  useDateFromUnixMS,
  usePostStats,
  useQueryIfAdded,
  useUsernameCRDTQuery,
} from '../../../hooks/queryHooks'
import { PurePost, PurePostProps } from './PurePost'

interface PostProps {
  data: ParsedEvent<Protocol.Post>
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

  let stats = usePostStats(pointer)

  stats = useMemo(
    () => ({ ...stats, likes: stats.likes + (likedLocal && !likedStored ? 1 : 0) }),
    [stats, likedLocal, likedStored],
  )

  return {
    stats,
    actions,
  }
}

// eslint-disable-next-line react/display-name
export const Post = forwardRef<HTMLDivElement, PostProps>(({ data }, ref) => {
  const { value, event, signedEvent } = data
  const {
    content,
    // image,
  } = value

  const pointer = useMemo(() => Models.signedEventToPointer(signedEvent), [signedEvent])

  const mainUsername = useUsernameCRDTQuery(event.system)
  const mainAvatar = useAvatar(event.system)
  const mainDate = useDateFromUnixMS(event.unixMilliseconds)

  const main: PurePostProps['main'] = useMemo(
    () => ({
      author: {
        name: mainUsername,
        avatarURL: mainAvatar,
      },
      content: content ?? '',
      topic: 'todo',
      publishedAt: mainDate,
    }),
    [mainUsername, mainAvatar, content, mainDate],
  )

  const { actions, stats } = usePostStatsWithLocalActions(pointer)

  return <PurePost ref={ref} main={main} stats={stats} actions={actions} />
})
