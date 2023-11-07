import { decode } from '@borderless/base64'
import { Models, Protocol } from '@polycentric/polycentric-core'
import { useCallback, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { PureSidebarProfile } from '../../components'
import { InfiniteScrollWithRightCol } from '../../components/layout/infinitescrollwithrightcol'
import { useAuthorFeed } from '../../hooks/feedHooks'
import { useProcessHandleManager } from '../../hooks/processHandleManagerHooks'
import { useAvatar, useQueryIfAdded, useUsernameCRDTQuery } from '../../hooks/queryHooks'

const UserColumn = ({ system }: { system: Models.PublicKey.PublicKey }) => {
  const name = useUsernameCRDTQuery(system)
  const avatarURL = useAvatar(system)
  const { processHandle } = useProcessHandleManager()

  const [localFollowing, setLocalFollowing] = useState<boolean | undefined>()
  const remotelyFollowing = useQueryIfAdded(
    Models.ContentType.ContentTypeFollow,
    processHandle.system(),
    Protocol.PublicKey.encode(system).finish(),
  )

  const follow = useCallback(() => {
    processHandle.follow(system).then(() => setLocalFollowing(true))
  }, [processHandle, system])

  const unfollow = useCallback(() => {
    processHandle.unfollow(system).then(() => setLocalFollowing(false))
  }, [processHandle, system])

  const isMyProfile = Models.PublicKey.equal(system, processHandle.system())

  const followers = 0
  const following = 0

  const iAmFollowing = localFollowing ? localFollowing : remotelyFollowing

  return (
    <PureSidebarProfile
      profile={{
        name,
        avatarURL,
        isMyProfile,
        iAmFollowing: iAmFollowing,
        followerCount: followers,
        followingCount: following,
      }}
      follow={follow}
      unfollow={unfollow}
    />
  )
}

export const UserFeedPage = () => {
  const { urlInfoString } = useParams<{ urlInfoString: string }>()
  const { processHandle } = useProcessHandleManager()

  const { system } = useMemo(() => {
    const urlInfoBuffer = decode(urlInfoString)
    const urlInfo = Protocol.URLInfo.decode(urlInfoBuffer)
    const { system, servers } = Models.URLInfo.getSystemLink(urlInfo)
    servers.forEach((server) => {
      processHandle.addAddressHint(system, server)
    })

    return { system, servers }
  }, [urlInfoString, processHandle])

  const [data, advanceFeed] = useAuthorFeed(system)

  const column = <UserColumn system={system} />

  return (
    <InfiniteScrollWithRightCol
      data={data}
      advanceFeed={advanceFeed}
      leftCol={column}
      showComposeOnDesktop={Models.PublicKey.equal(system, processHandle.system())}
    />
  )
}
