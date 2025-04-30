import { Onboarding } from '../components';
import { OAuthCallback } from '../components/oauth/callback';
import { FollowingFeed } from '../pages/following';
import { ForumBoardPage } from '../pages/forums/ForumBoardPage';
import { ForumCategoryListPage } from '../pages/forums/ForumCategoryListPage';
import { ForumServerListPage } from '../pages/forums/ForumServerListPage';
import { ForumThreadPage } from '../pages/forums/ForumThreadPage';
import { HomeFeedPage } from '../pages/homefeed';
import { PostFeedPage } from '../pages/postfeed';
import { SearchPage } from '../pages/search';
import { SettingsPage } from '../pages/settings';
import { TopicFeedPage } from '../pages/topicfeed';
import { UserFeedPage } from '../pages/userfeed';

export type Page = React.ComponentType;
export type RouteData = Record<string, { component: Page; root?: boolean }>;

export const routes: RouteData = {
  '/': { component: HomeFeedPage, root: true },
  '/t/*': { component: TopicFeedPage },
  '/user/:urlInfoString': { component: UserFeedPage },
  '/post/:urlInfoString': { component: PostFeedPage },
  '/search/:query': { component: SearchPage },
  '/settings': { component: SettingsPage },
  '/add-account': { component: Onboarding },
  '/following': { component: FollowingFeed },
  '/forums': { component: ForumServerListPage },
  '/forums/:serverUrl': { component: ForumCategoryListPage },
  '/forums/:serverUrl/:categoryId/:boardId': { component: ForumBoardPage },
  '/forums/:serverUrl/:categoryId/:boardId/:threadId': { component: ForumThreadPage },
  '/oauth/callback': { component: OAuthCallback },
};
