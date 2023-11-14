import { HomeFeedPage } from '../pages/homefeed'
import { UserFeedPage } from '../pages/userfeed'

export type Page = React.ComponentType<{ memoryPath?: string }>
type RouteData = Record<string, { component: Page; root?: boolean }>

export const routeData: RouteData = {
  '/': { component: HomeFeedPage, root: true },
  '/t/:topic': { component: HomeFeedPage },
  '/user/:urlInfoString': { component: UserFeedPage },
}
