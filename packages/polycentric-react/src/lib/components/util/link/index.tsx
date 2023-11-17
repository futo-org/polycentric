import { RouterDirection } from '@ionic/core'
import { IonContent, IonNavLink, IonPage, IonRouterLink } from '@ionic/react'
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
  } & React.HTMLAttributes<HTMLElement>
>(({ routerLink, children, routerDirection, className, ...browserProps }, ref) => {
  const isMobile = useIsMobile()

  const renderMemoryPage = useCallback(
    () => (
      <MemoryRoutedLinkContext.Provider value={routerLink}>
        <IonPage>
          <IonContent>
            <MemoryRoutedComponent routerLink={routerLink} />
          </IonContent>
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
      <IonNavLink
        // @ts-ignore
        // We just need the ref for standard HTML attributes, not fancy Ionic stuff
        ref={ref}
        component={renderMemoryPage}
        className={`${className} text-inherit`}
        routerDirection={routerDirection}
        {...browserProps}
      >
        {children}
      </IonNavLink>
    )
  }

  return (
    <IonRouterLink
      // @ts-ignore
      ref={ref}
      routerLink={routerLink}
      className={`${className} text-inherit`}
      routerDirection={routerDirection}
      {...browserProps}
    >
      {children}
    </IonRouterLink>
  )
})

LinkComponent.displayName = 'Link'
export const Link = LinkComponent