import { RouterDirection } from '@ionic/core'
import { IonNavLink, IonPage, IonRouterLink, isPlatform } from '@ionic/react'
import React, { forwardRef, useCallback, useMemo } from 'react'
import { matchPath } from 'react-router-dom'
import { routeData } from '../../../app/router'
import { useLocation } from '../../../hooks/stackRouterHooks'
import { useIsMobile } from '../../../hooks/styleHooks'
import { MemoryRoutedLinkContext } from './routedmemorylinkcontext'

const getUrlComponent = (url: string) => {
  const path = Object.keys(routeData).find((path) => {
    const match = matchPath(url, { path, exact: true })
    if (match) return true
  })

  return path ? routeData[path].component : null
}

const MemoryRoutedComponent = ({ routerLink }: { routerLink?: string }) => {
  const Component = useMemo(() => {
    if (!routerLink) return undefined
    return getUrlComponent(routerLink)
  }, [routerLink])

  if (!Component) return null

  return <Component />
}

const LinkComponent = forwardRef<
  HTMLElement,
  {
    routerLink?: string
    children?: React.ReactNode
    className?: string
    routerDirection?: RouterDirection
  } & React.HTMLAttributes<HTMLAnchorElement>
>(({ routerLink, children, routerDirection, className, ...browserProps }, ref) => {
  const isMobile = useIsMobile()
  const isIOS = useMemo(() => isMobile && isPlatform('ios'), [isMobile])

  const renderMemoryPage = useCallback(
    () => (
      <MemoryRoutedLinkContext.Provider value={routerLink}>
        <IonPage>
          <MemoryRoutedComponent routerLink={routerLink} />
        </IonPage>
      </MemoryRoutedLinkContext.Provider>
    ),
    [routerLink],
  )

  const location = useLocation()

  if (routerLink === location) {
    return <div className={className}>{children}</div>
  }

  if (isMobile && routerDirection !== 'root') {
    return (
      <div
        onClick={() => {
          // On Android, since we're using back button navigation,
          // we need to push a random query string to the history so that we can use the back button
          if (isIOS === false && routerDirection !== 'back') {
            // push random query string to history so we can go back
            window.history.pushState({}, '', window.location.pathname + '?')
          }
        }}
      >
        <IonNavLink
          // @ts-ignore
          // We just need the ref for standard HTML attributes, not fancy Ionic stuff
          ref={ref}
          component={renderMemoryPage}
          className={`${className}`}
          routerDirection={routerDirection}
          {...browserProps}
        >
          {children}
        </IonNavLink>
      </div>
    )
  }

  return (
    <IonRouterLink
      // @ts-ignore
      ref={ref}
      routerLink={routerLink}
      className={`${className}`}
      routerDirection={routerDirection}
      {...browserProps}
    >
      {children}
    </IonRouterLink>
  )
})

LinkComponent.displayName = 'Link'
export const Link = LinkComponent
