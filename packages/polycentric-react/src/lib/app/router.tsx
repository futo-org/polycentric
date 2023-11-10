import { IonPage } from '@ionic/react'
import { Route as RouterRoute } from 'react-router-dom'
import { HomeFeedPage } from '../pages/homefeed'
import { UserFeedPage } from '../pages/userfeed'

export const Route = ({
  children,
  path,
  allowMobileDrawer = false,
}: {
  children: React.ReactNode
  path?: string
  allowMobileDrawer?: boolean
}) => (
  <IonPage className="bg-white" id={allowMobileDrawer ? 'main-drawer' : undefined}>
    <RouterRoute path={path}>{children}</RouterRoute>
  </IonPage>
)

export const AppRouter = () => (
  <>
    <Route path="/" allowMobileDrawer={true}>
      <HomeFeedPage />
    </Route>
    <Route path="/t/:topic">
      <p>wip</p>
    </Route>
    <Route path="/user/:urlInfoString">
      <UserFeedPage />
    </Route>
    {/* <Route path="/:urlinfo">
      <URLInfoRouter />
    </Route> */}
  </>
)
