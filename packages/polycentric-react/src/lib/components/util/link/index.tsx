import { RouterDirection } from '@ionic/core';
import { IonPage } from '@ionic/react';
import React, { forwardRef, useCallback, useContext, useMemo } from 'react';
import { matchPath } from 'react-router-dom';
import { StackRouterContext } from '../../../app/contexts';
import { routes } from '../../../app/routes';
import { StackElementPathContext } from './StackElementPathContext';

const getUrlComponent = (url: string) => {
  const path = Object.keys(routes).find((pathKey) => {
    const exact = !pathKey.includes('*');
    const match = matchPath(url, { path: pathKey, exact });
    return !!match;
  });
  return path ? routes[path].component : null;
};

export const MemoryRoutedComponent = ({
  routerLink,
}: {
  routerLink: string;
}) => {
  const Component = useMemo(() => {
    return getUrlComponent(routerLink);
  }, [routerLink]);

  if (!Component) {
    console.error('[MemoryRoutedComponent] No component found for routerLink', routerLink);
    return (
      <IonPage>
        <div>404 - Component Not Found for {routerLink}</div>
      </IonPage>
    );
  }

  return (
    <StackElementPathContext.Provider value={routerLink}>
      <IonPage>
        <Component />
      </IonPage>
    </StackElementPathContext.Provider>
  );
};

interface LinkProps {
  routerLink?: string;
  children?: React.ReactNode;
  className?: string;
  activeClassName?: string;
  routerDirection?: RouterDirection;
  stopPropagation?: boolean;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  presentHref?: boolean;
}

const LinkComponent = forwardRef<
  HTMLAnchorElement,
  LinkProps & React.HTMLAttributes<HTMLAnchorElement>
>(
  (
    {
      routerLink,
      children,
      routerDirection = 'forward',
      className,
      activeClassName,
      stopPropagation,
      presentHref,
      onClick: userPassedOnClick,
      ...browserProps
    },
    ref,
  ) => {
    const stackRouter = useContext(StackRouterContext);

    const isActive = useMemo(() => {
      const currentApplicationPath = stackRouter.currentPath;
      return currentApplicationPath === routerLink;
    }, [stackRouter.currentPath, routerLink]);

    const onClick: React.MouseEventHandler<HTMLAnchorElement> = useCallback(
      (e) => {
        console.log("[LinkComponent onClick] Clicked!", { routerLink, routerDirection });
        e.preventDefault();

        if (stopPropagation) {
          console.log("[LinkComponent onClick] Stopping propagation.");
          e.stopPropagation();
        }
        if (!routerLink) {
          console.log("[LinkComponent onClick] No routerLink, returning.");
          return;
        }

        userPassedOnClick?.(e);
        if (isActive) {
          console.log("[LinkComponent onClick] Link is already active, returning.");
          return;
        }

        switch (routerDirection) {
          case 'root':
            console.log(`[LinkComponent onClick] Navigating root: ${routerLink}`);
            stackRouter.setRoot(routerLink, 'forwards');
            break;
          case 'forward':
            console.log(`[LinkComponent onClick] Navigating forward: ${routerLink}`);
            stackRouter.push(routerLink);
            break;
          case 'back':
            console.log(`[LinkComponent onClick] Navigating back`);
            stackRouter.pop();
            break;
          default:
            console.error('[Link onClick] Invalid routerDirection', routerDirection);
        }
      },
      [
        routerLink,
        routerDirection,
        stackRouter,
        isActive,
        stopPropagation,
        userPassedOnClick,
      ],
    );

    return (
      <a
        className={`${className} ${isActive ? activeClassName : ''}`}
        onClick={onClick}
        ref={ref}
        href={isActive || presentHref === false ? undefined : routerLink}
        {...browserProps}
      >
        {children}
      </a>
    );
  },
);

LinkComponent.displayName = 'Link';
export const Link = LinkComponent;
