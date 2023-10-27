import { decode } from '@borderless/base64'
import { Models, Protocol } from '@polycentric/polycentric-core'
import { useMemo } from 'react'
import { useParams } from 'react-router-dom'
import { PureSidebarProfile } from '../../components'
import { InfiniteScrollWithRightCol } from '../../components/layout/infinitescrollwithrightcol'
import { useAuthorFeed } from '../../hooks/feedHooks'
import { useProcessHandleManager } from '../../hooks/processHandleManagerHooks'
import { useAvatar, useUsernameCRDTQuery } from '../../hooks/queryHooks'

const UserColumn = ({ system }: { system?: Models.PublicKey.PublicKey }) => {
  const name = useUsernameCRDTQuery(system)
  const avatarURL = useAvatar(system)

  return (
    <PureSidebarProfile
      profile={{
        name,
        avatarURL,
      }}
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
