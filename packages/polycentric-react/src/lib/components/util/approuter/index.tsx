import { IonContent, IonNav, IonPage } from '@ionic/react'
import { useCallback, useRef } from 'react'
import { Route as RouterRoute } from 'react-router-dom'

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

export const AppRouter = () => (
  <>
    {Object.entries(routeData).map(([path, { component, root }]) => (
      <Route path={path} key={path} rootPath={root} Component={component} />
    ))}
  </>
)
