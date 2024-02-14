import { RouterDirection } from '@ionic/core';
import { IonPage } from '@ionic/react';
import React, { forwardRef, useCallback, useContext, useMemo } from 'react';
import { matchPath } from 'react-router-dom';
import { StackRouterContext } from '../../../app/StackRouterContext';
import { routeData } from '../../../app/router';
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
        const stackRouter = useContext(StackRouterContext);

        const isActive = useMemo(() => {
            const currentApplicationPath = stackRouter.currentPath;
            return currentApplicationPath === routerLink;
        }, [stackRouter.currentPath, routerLink]);

        const onClick: React.MouseEventHandler<HTMLAnchorElement> = useCallback(
            (e) => {
                e.preventDefault();

                if (!routerLink) return;
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
                        console.error(
                            'Invalid routerDirection',
                            routerDirection,
                        );
                }
            },
            [routerLink, routerDirection, stackRouter, isActive],
        );

        return (
            <a
                className={`${className} ${isActive ? activeClassName : ''}`}
                onClick={onClick}
                ref={ref}
                href={isActive ? undefined : routerLink}
                {...browserProps}
            >
                {children}
            </a>
        );
    },
);

LinkComponent.displayName = 'Link';
export const Link = LinkComponent;
