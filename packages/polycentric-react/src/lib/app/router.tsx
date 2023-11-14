import { IonContent, IonNav, IonPage } from '@ionic/react'
import { useCallback, useRef } from 'react'
import { Route as RouterRoute } from 'react-router-dom'
import { HomeFeedPage } from '../pages/homefeed'
import { PostFeedPage } from '../pages/postfeed'
import { UserFeedPage } from '../pages/userfeed'

export const Route = ({
  Component,
  path,
  rootPath = false,
}: {
  Component: Page
  path?: string
  rootPath?: boolean
}) => {
  const navref = useRef<HTMLIonNavElement>(null)

  // id={allowMobileDrawer ? 'main-drawer' : undefined
  const root = useCallback(() => {
    return (
      <IonContent>
        <Component />
      </IonContent>
    )
  }, [Component])

  if (rootPath) {
    return (
      <RouterRoute path={path} exact={true}>
        <IonPage>
          <IonNav root={root} ref={navref} />
        </IonPage>
      </RouterRoute>
    )
  }

  return (
    <RouterRoute path={path} exact={true}>
      <IonNav root={root} ref={navref} />
    </RouterRoute>
  )
}

export type Page = React.ComponentType<{ memoryPath?: string }>
type RouteData = Record<string, { component: Page; root?: boolean }>

export const routeData: RouteData = {
  '/': { component: HomeFeedPage, root: true },
  '/t/:topic': { component: HomeFeedPage },
  '/user/:urlInfoString': { component: UserFeedPage },
  '/post/:urlInfoString/': { component: PostFeedPage },
  '/post/:urlInfoString/:id': { component: PostFeedPage },
}

export const AppRouter = () => (
  <>
    {Object.entries(routeData).map(([path, { component, root }]) => (
      <Route path={path} key={path} rootPath={root} Component={component} />
    ))}
  </>
)
