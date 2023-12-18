import { decode } from '@borderless/base64'
import { IonContent } from '@ionic/react'
import { Models, Protocol } from '@polycentric/polycentric-core'
import { useMemo } from 'react'
import { Page } from '../../app/router'
import { Header } from '../../components/layout/header'
import { InfiniteScrollWithRightCol } from '../../components/layout/infinitescrollwithrightcol'
import { UserColumn } from '../../components/profile/sidebarprofile'
import { useCommentFeed } from '../../hooks/feedHooks'
import { useProcessHandleManager } from '../../hooks/processHandleManagerHooks'
import { useQueryPost } from '../../hooks/queryHooks'
import { useParams } from '../../hooks/stackRouterHooks'

export const PostFeedPage: Page = () => {
  const { urlInfoString } = useParams<{ urlInfoString: string }>()
  const { processHandle } = useProcessHandleManager()

  const { system, logicalClock, process } = useMemo(() => {
    const urlInfoBuffer = decode(urlInfoString)
    const urlInfo = Protocol.URLInfo.decode(urlInfoBuffer)
    const linkInfo = Models.URLInfo.getEventLink(urlInfo)
    linkInfo.servers.forEach((server) => {
      processHandle.addAddressHint(linkInfo.system, server)
    })

    return linkInfo
  }, [urlInfoString, processHandle])

  const postEvent = useQueryPost(system, process, logicalClock)

  const column = <UserColumn system={system} />

  const [comments, advanceComments, , prependCount] = useCommentFeed(postEvent?.signedEvent)

  return (
    <>
      <Header>Post</Header>

      <IonContent>
        <InfiniteScrollWithRightCol
          data={comments}
          advanceFeed={advanceComments}
          prependCount={prependCount}
          leftCol={column}
          topFeedComponent={undefined}
        />
      </IonContent>
    </>
  )
}
