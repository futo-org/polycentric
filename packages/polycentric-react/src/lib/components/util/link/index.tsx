import { RouterDirection } from '@ionic/core';
import { IonPage, isPlatform } from '@ionic/react';
import React, { forwardRef, useCallback, useContext, useMemo } from 'react';
import { matchPath } from 'react-router-dom';
import { StackRouterContext } from '../../../app/index';
import { routeData } from '../../../app/router';
import { useIsMobile } from '../../../hooks/styleHooks';
import { StackElementPathContext } from './StackElementPathContext';

const getUrlComponent = (url: string) => {
    const path = Object.keys(routeData).find((path) => {
        const match = matchPath(url, { path, exact: true });
        if (match) return true;
    });

    return path ? routeData[path].component : null;
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

const LinkComponent = forwardRef<
    HTMLAnchorElement,
    {
        routerLink?: string;
        children?: React.ReactNode;
        className?: string;
        activeClassName?: string;
        routerDirection?: RouterDirection;
    } & React.HTMLAttributes<HTMLAnchorElement>
>(
    (
        {
            routerLink,
            children,
            routerDirection = 'forward',
            className,
            activeClassName,
            ...browserProps
        },
        ref,
    ) => {
        const isMobile = useIsMobile();
        const isIOS = useMemo(() => isMobile && isPlatform('ios'), [isMobile]);

        const stackRouter = useContext(StackRouterContext);

        const onClick: React.MouseEventHandler<HTMLAnchorElement> = useCallback(
            (e) => {
                e.preventDefault();
                if (!routerLink) return;
                if (isIOS === false && routerDirection !== 'back') {
                    // push random query string to history so we can go back
                    window.history.pushState({}, '', routerLink);
                }
                switch (routerDirection) {
                    case 'root':
                        stackRouter.setRoot(routerLink);
                        break;
                    case 'forward':
                        stackRouter.push(routerLink);
                        break;
                    case 'back':
                        stackRouter.pop();
                        break;
                }
            },
            [routerLink, routerDirection, isIOS, stackRouter],
        );

        const isActive = useMemo(() => {
            const currentApplicationPath = stackRouter.currentPath;
            return currentApplicationPath === routerLink;
        }, [stackRouter.currentPath, routerLink]);

        return (
            <a
                className={`${className} ${isActive ? activeClassName : ''}`}
                onClick={onClick}
                ref={ref}
                {...browserProps}
            >
                {children}
            </a>
        );
    },
);

LinkComponent.displayName = 'Link';
export const Link = LinkComponent;
