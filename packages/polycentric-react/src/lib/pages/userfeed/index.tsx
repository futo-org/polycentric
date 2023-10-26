import { decode } from '@borderless/base64'
import { Models, Protocol } from '@polycentric/polycentric-core'
import { useCallback, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { PureSidebarProfile } from '../../components'
import { InfiniteScrollWithRightCol } from '../../components/layout/infinitescrollwithrightcol'
import { PureMobileFeedProfile } from '../../components/profile/PureMobileFeedProfile'
import { useAuthorFeed } from '../../hooks/feedHooks'
import { useProcessHandleManager } from '../../hooks/processHandleManagerHooks'
import { useAvatar, useUsernameCRDTQuery } from '../../hooks/queryHooks'

const UserColumn = ({ system }: { system?: Models.PublicKey.PublicKey }) => {
  const name = useUsernameCRDTQuery(system)
  const avatarURL = useAvatar(system)
  const { processHandle } = useProcessHandleManager()
  const [localFollowing, setLocalFollowing] = useState<boolean>(false)

  const follow = useCallback(() => {
    if (system) processHandle.follow(system).then(() => setLocalFollowing(true))
  }, [processHandle, system])

  const unfollow = useCallback(() => {
    if (system) processHandle.unfollow(system).then(() => setLocalFollowing(false))
  }, [processHandle, system])

  return (
    <PureSidebarProfile
      profile={{
        name,
        avatarURL,
        iAmFollowing: localFollowing,
        isMyProfile: system != null && Models.PublicKey.equal(system, processHandle.system()),
      }}
      follow={follow}
      unfollow={unfollow}
    />
  )
}

const MobileFeedProfile = ({ system }: { system?: Models.PublicKey.PublicKey }) => {
  const name = useUsernameCRDTQuery(system)
  const avatarURL = useAvatar(system)
  const { processHandle } = useProcessHandleManager()

  const [localFollowing, setLocalFollowing] = useState<boolean>(false)

  const follow = useCallback(() => {
    if (system) processHandle.follow(system).then(() => setLocalFollowing(true))
  }, [processHandle, system])

  const unfollow = useCallback(() => {
    if (system) processHandle.unfollow(system).then(() => setLocalFollowing(false))
  }, [processHandle, system])

  return (
    <PureMobileFeedProfile
      profile={{
        name,
        avatarURL,
        iAmFollowing: localFollowing,
        isMyProfile: system != null && Models.PublicKey.equal(system, processHandle.system()),
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

  const column = useMemo(() => <UserColumn system={system} />, [system])
  const mobilePreview = useMemo(() => <MobileFeedProfile system={system} />, [system])

  return (
    <InfiniteScrollWithRightCol
      data={data}
      advanceFeed={advanceFeed}
      leftCol={column}
      showComposeOnDesktop={Models.PublicKey.equal(system, processHandle.system())}
      mobileTopComponent={mobilePreview}
    />
  )
}
