import { ReactNode } from 'react'
import { InfiniteScrollWithRightCol } from '../../../components/layout/infinitescrollwithrightcol'
import { FeedHookAdvanceFn, FeedHookData } from '../../../hooks/feedHooks'

export const FeedPage = ({
  data,
  advanceFeed,
  leftCol,
}: {
  data: FeedHookData
  advanceFeed: FeedHookAdvanceFn
  leftCol: ReactNode
}) => {
  return <InfiniteScrollWithRightCol data={data} advanceFeed={advanceFeed} leftCol={leftCol} />
}
