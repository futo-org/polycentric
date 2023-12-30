import { decode } from '@borderless/base64'
import { IonContent } from '@ionic/react'
import { Models, Protocol } from '@polycentric/polycentric-core'
import { useMemo } from 'react'
import { Page } from '../../app/router'
import { PostCompose } from '../../components/feed/Compose/PostCompose'
import { Header } from '../../components/layout/header'
import { InfiniteScrollWithRightCol } from '../../components/layout/infinitescrollwithrightcol'
import { MobileProfileFeed } from '../../components/profile/mobilefeedprofile'
import { UserColumn } from '../../components/profile/sidebarprofile/UserColumn'
import { useAuthorFeed } from '../../hooks/feedHooks'
import { useProcessHandleManager } from '../../hooks/processHandleManagerHooks'
import { useTextPublicKey, useUsernameCRDTQuery } from '../../hooks/queryHooks'
import { useParams } from '../../hooks/stackRouterHooks'
import { useIsMobile } from '../../hooks/styleHooks'

export const UserFeedPage: Page = () => {
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

  const isMobile = useIsMobile()
  const isMyProfile = useMemo(() => Models.PublicKey.equal(system, processHandle.system()), [system, processHandle])

  const username = useUsernameCRDTQuery(system)
  const headerText = useMemo(() => {
    if (!username) return 'Profile'
    return `${username}'s Profile`
  }, [username])

  const stringKey = useTextPublicKey(system)

  const topComponent = useMemo(() => {
    if (isMobile) return <MobileProfileFeed system={system} key={stringKey} />
    return isMyProfile ? <PostCompose /> : undefined
  }, [isMobile, isMyProfile, system, stringKey])

  return (
    <>
      <Header>{headerText}</Header>
      <IonContent>
        <InfiniteScrollWithRightCol
          data={data}
          advanceFeed={advanceFeed}
          leftCol={column}
          topFeedComponent={topComponent}
        />
      </IonContent>
    </>
  )
}
