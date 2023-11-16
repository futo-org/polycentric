import { decode } from '@borderless/base64'
import { Models, Protocol } from '@polycentric/polycentric-core'
import { useCallback, useMemo } from 'react'
import { Page } from '../../app/router'
import { Post } from '../../components'
import { InfiniteScrollWithRightCol } from '../../components/layout/infinitescrollwithrightcol'
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

  const todoAdvanceComments = useCallback(() => {}, [])

  const postEvent = useQueryPost(system, process, logicalClock)
  const post = useMemo(() => {
    return <Post data={postEvent} doesLink={false} />
  }, [postEvent])

  return (
    <InfiniteScrollWithRightCol
      data={[]}
      advanceFeed={todoAdvanceComments}
      leftCol={<div></div>}
      topFeedComponent={post}
    />
  )
}
