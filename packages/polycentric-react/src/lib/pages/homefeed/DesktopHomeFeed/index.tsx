import { InfiniteScrollWithRightCol } from '../../../components/layout/infinitescrollwithrightcol'

export const DesktopHomeFeed = () => {
  return <InfiniteScrollWithRightCol data={[]} advanceFeed={() => 0} leftCol={<p></p>} showComposeOnDesktop={true} />
}
