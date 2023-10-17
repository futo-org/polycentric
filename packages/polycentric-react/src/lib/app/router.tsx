import { IonPage } from '@ionic/react'
import { Route } from 'react-router-dom'
import { HomeFeedPage } from '../pages/homefeed'
import { UserFeedPage } from '../pages/userfeed'

export const Page = ({
  children,
  allowMobileDrawer = false,
}: {
  children: React.ReactNode
  allowMobileDrawer?: boolean
}) => (
  <IonPage className="bg-white" id={allowMobileDrawer ? 'main-drawer' : undefined}>
    {children}
  </IonPage>
)

export const AppRouter = () => (
  <>
    <Route path="/">
      <Page allowMobileDrawer={true}>
        <HomeFeedPage />
      </Page>
    </Route>
    <Route path="/t/:topic">
      <Page><p>wip</p></Page>
    </Route>
    <Route path="/user/:urlInfoString">
      <Page>
        <UserFeedPage />
      </Page>
    </Route>
    {/* <Route path="/:urlinfo">
      <URLInfoRouter />
    </Route> */}
  </>
)
