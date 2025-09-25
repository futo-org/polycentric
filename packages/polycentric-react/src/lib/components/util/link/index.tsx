/**
 * @fileoverview Custom link component with stack-based navigation and route matching.
 */

import { RouterDirection } from '@ionic/core';
import { IonPage } from '@ionic/react';
import React, { forwardRef, useCallback, useContext, useMemo } from 'react';
import { matchPath } from 'react-router-dom';
import { StackRouterContext } from '../../../app/contexts';
import { routes } from '../../../app/routes';
import { StackElementPathContext } from './StackElementPathContext';

// Route matching utility to find component for URL
const getUrlComponent = (url: string) => {
  const path = Object.keys(routes).find((path) => {
    const match = matchPath(url, {
      path,
      exact: true,
    });
    if (match) return true;
  });

  return path ? routes[path].component : null;
};

// Component wrapper for memory-based routing with stack context
export const MemoryRoutedComponent = ({
  routerLink,
}: {
  routerLink: string;
}) => {
  const Component = useMemo(() => {
    return getUrlComponent(routerLink);
  }, [routerLink]);

  if (!Component) {
    console.error('No component found for routerLink', routerLink);
    return null;
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

// Custom link component with stack navigation and active state management
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
        e.preventDefault();

        if (stopPropagation) e.stopPropagation();
        if (!routerLink) return;

        userPassedOnClick?.(e);
        if (isActive) return;

        switch (routerDirection) {
          case 'root':
            stackRouter.setRoot(routerLink, 'forwards');
            break;
          case 'forward':
            stackRouter.push(routerLink);
            break;
          case 'back':
            stackRouter.pop();
            break;
          default:
            console.error('Invalid routerDirection', routerDirection);
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
