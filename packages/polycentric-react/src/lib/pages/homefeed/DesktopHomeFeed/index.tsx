import { InfiniteScrollWithRightCol } from '../../../components/layout/infinitescrollwithrightcol'
import { useExploreFeed } from '../../../hooks/feedHooks'

export const DesktopHomeFeed = () => {
  const [data, advanceFeed] = useExploreFeed()
  const compose = <Compose hideTopic={true} />
}
