import { decode } from '@borderless/base64'
import { Models, Protocol } from '@polycentric/polycentric-core'
import { useCallback, useMemo, useState } from 'react'
import { Page } from '../../app/router'
import { PureSidebarProfile } from '../../components'
import { PostCompose } from '../../components/feed/Compose/PostCompose'
import { InfiniteScrollWithRightCol } from '../../components/layout/infinitescrollwithrightcol'
import { UserColumn } from '../../components/profile/UserColumn'
import { useAuthorFeed } from '../../hooks/feedHooks'
import { useProcessHandleManager } from '../../hooks/processHandleManagerHooks'
import { useAvatar, useQueryIfAdded, useUsernameCRDTQuery } from '../../hooks/queryHooks'
import { useParams, usePath } from '../../hooks/stackRouterHooks'

export const UserFeedPage: Page = ({ memoryPath }: { memoryPath?: string }) => {
  const path = usePath(memoryPath)
  const { urlInfoString } = useParams<{ urlInfoString: string }>(path)
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

  const isMyProfile = Models.PublicKey.equal(system, processHandle.system())

  const topComponent = isMyProfile ? <PostCompose /> : undefined

  return (
    <InfiniteScrollWithRightCol
      data={data}
      advanceFeed={advanceFeed}
      leftCol={column}
      topFeedComponent={topComponent}
    />
  )
}
