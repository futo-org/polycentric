import { Onboarding } from '../components';
import { FollowingFeed } from '../pages/following';
import { HomeFeedPage } from '../pages/homefeed';
import { PostFeedPage } from '../pages/postfeed';
import { SearchPage } from '../pages/search';
import { SettingsPage } from '../pages/settings';
import { TopicFeedPage } from '../pages/topicfeed';
import { UserDislikesFeedPage } from '../pages/userdislikesfeed';
import { UserFeedPage } from '../pages/userfeed';
import { UserLikesFeedPage } from '../pages/userlikesfeed';

export type Page = React.ComponentType;
type RouteData = Record<string, { component: Page; root?: boolean }>;

export const routeData: RouteData = {
  '/': { component: HomeFeedPage, root: true },
  '/t/*': { component: TopicFeedPage },
  '/user/:urlInfoString': { component: UserFeedPage },
  '/user/:urlInfoString/likes': { component: UserLikesFeedPage },
  '/user/:urlInfoString/dislikes': { component: UserDislikesFeedPage },
  '/post/:urlInfoString': { component: PostFeedPage },
  '/search/:query': { component: SearchPage },
  '/settings': { component: SettingsPage },
  '/add-account': { component: Onboarding },
  '/following': { component: FollowingFeed },
};
