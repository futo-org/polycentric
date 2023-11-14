import { IonContent, IonNav, IonPage } from '@ionic/react'
import { useCallback, useEffect, useRef } from 'react'
import { Route as RouterRoute } from 'react-router-dom'
import { HomeFeedPage } from '../pages/homefeed'
import { PostFeedPage } from '../pages/postfeed'
import { UserFeedPage } from '../pages/userfeed'
import { createSwipeBackGesture } from '../util/ionicfullpageswipebackgesture'

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

  useEffect(() => {
    // Allow swiping back anywhere on page
    // The only other way to do this is to distribute our own ionic build
    // https://github.com/ionic-team/ionic-framework/blob/83f9ac0face445c7f4654dea1a6a43e4565fb800/core/src/components/nav/nav.tsx#L135
    // https://github.com/ionic-team/ionic-framework/blob/main/core/src/utils/gesture/swipe-back.ts
    if (navref.current)
      // @ts-ignore
      navref.current.gesture = createSwipeBackGesture(
        navref.current,
        // @ts-ignore
        navref.current.canStart.bind(navref.current),
        // @ts-ignore
        navref.current.onStart.bind(navref.current),
        // @ts-ignore
        navref.current.onMove.bind(navref.current),
        // @ts-ignore
        navref.current.onEnd.bind(navref.current),
        1000,
      )
  }, [navref])

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
