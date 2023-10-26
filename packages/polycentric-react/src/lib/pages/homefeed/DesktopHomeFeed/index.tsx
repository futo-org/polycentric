import { InfiniteScrollWithRightCol } from '../../../components/layout/infinitescrollwithrightcol'
import { useExploreFeed } from '../../../hooks/feedHooks'

export const DesktopHomeFeed = () => {
  const [data, advanceFeed] = useExploreFeed()
  return <InfiniteScrollWithRightCol data={data} advanceFeed={advanceFeed} leftCol={null} showComposeOnDesktop={true} />
}
