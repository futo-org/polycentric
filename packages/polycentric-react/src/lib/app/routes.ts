/**
 * @fileoverview Centralized route configuration for the application.
 */

import { Onboarding } from '../components';
import { OAuthCallback } from '../components/oauth/callback';
import { FollowingFeed } from '../pages/following';
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
  '/oauth/callback': { component: OAuthCallback },
};
