import { IonNav, IonPage } from '@ionic/react'
import { useCallback, useEffect, useRef } from 'react'
import { Route as RouterRoute } from 'react-router-dom'
import { createSwipeBackGesture } from '../../../util/ionicfullpageswipebackgesture'

import { Page, routeData } from '../../../app/router'

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

  useEffect(() => {
    const listener = () => {
      navref.current?.canGoBack().then((canGoBack) => {
        if (canGoBack) {
          navref.current?.pop()
        }
      })
    }

    window.addEventListener('popstate', listener)

    return () => {
      window.removeEventListener('popstate', listener)
    }
  }, [])

  const root = useCallback(() => {
    return <Component />
  }, [Component])

  if (rootPath) {
    return (
      <RouterRoute path={path} exact={true}>
        <IonPage>
          <IonNav root={root} ref={navref} swipeGesture={true} />
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

export const AppRouter = () => (
  <>
    {Object.entries(routeData).map(([path, { component, root }]) => (
      <Route path={path} key={path} rootPath={root} Component={component} />
    ))}
  </>
)
