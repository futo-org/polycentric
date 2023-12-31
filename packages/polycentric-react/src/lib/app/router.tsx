import { HomeFeedPage } from '../pages/homefeed';
import { PostFeedPage } from '../pages/postfeed';
import { SearchPage } from '../pages/search';
import { SettingsPage } from '../pages/settings';
import { TopicFeedPage } from '../pages/topicfeed';
import { UserFeedPage } from '../pages/userfeed';

export type Page = React.ComponentType;
type RouteData = Record<string, { component: Page; root?: boolean }>;

export const routeData: RouteData = {
    '/': { component: HomeFeedPage, root: true },
    '/t/*': { component: TopicFeedPage },
    '/user/:urlInfoString': { component: UserFeedPage },
    '/post/:urlInfoString': { component: PostFeedPage },
    '/search/:query': { component: SearchPage },
    '/settings': { component: SettingsPage },
};
