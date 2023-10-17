import { InfiniteScrollWithRightCol } from '../../../components/layout/infinitescrollwithrightcol'

export const DesktopHomeFeed = () => {
  return (
    <InfiniteScrollWithRightCol data={[]} advanceFeed={() => 0} LeftCol={() => <p>hi</p>} showComposeOnDesktop={true} />
  )
}
