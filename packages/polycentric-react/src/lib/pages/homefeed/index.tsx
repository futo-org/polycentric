import { useIsMobile } from '../../hooks/styleHooks'
import { DesktopHomeFeed } from './DesktopHomeFeed'
import { SwipeHomeFeed } from './SwipeHomeFeed'

export const HomeFeedPage = () => {
  const isMobile = useIsMobile()

  if (isMobile) {
    return <SwipeHomeFeed />
  }

  return <DesktopHomeFeed />
}
