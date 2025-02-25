import { IonNav, IonPage, IonRouterOutlet } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { Route } from 'react-router-dom';
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
type RouteData = Record<string, { component: Page; root?: boolean }>;

export const routeData: RouteData = {
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

// Wrap OAuthCallback in IonPage
const OAuthCallbackPage: React.FC = () => (
  <IonPage>
    <OAuthCallback />
  </IonPage>
);

export const Router: React.FC = () => {
  return (
    <IonReactRouter>
      <IonRouterOutlet>
        <Route path="/oauth/callback">
          <IonNav root={OAuthCallbackPage} />
        </Route>
        <Route exact path="/" component={HomeFeedPage} />
        <Route exact path="/t/*" component={TopicFeedPage} />
        <Route exact path="/user/:urlInfoString" component={UserFeedPage} />
        <Route exact path="/post/:urlInfoString" component={PostFeedPage} />
        <Route exact path="/search/:query" component={SearchPage} />
        <Route exact path="/settings" component={SettingsPage} />
        <Route exact path="/add-account" component={Onboarding} />
        <Route exact path="/following" component={FollowingFeed} />
      </IonRouterOutlet>
    </IonReactRouter>
  );
};
