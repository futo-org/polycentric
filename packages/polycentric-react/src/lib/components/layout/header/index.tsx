import { IonHeader, IonTitle, RouterDirection, isPlatform } from '@ionic/react';

import { ChevronLeftIcon } from '@heroicons/react/24/outline';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useIsMobile } from '../../../hooks/styleHooks';
import { Link } from '../../util/link';

export const Header = ({
    children,
    canHaveBackButton = true,
}: {
    children?: React.ReactNode;
    canHaveBackButton?: boolean;
}) => {
    const isMobile = useIsMobile();
    const ref = useRef<HTMLIonHeaderElement>(null);

    const [nav, setNav] = useState<HTMLIonNavElement | null>(null);
    useEffect(() => {
        setNav(ref.current?.closest('ion-nav') as HTMLIonNavElement);
    }, [ref]);

    // @ts-ignore - canGoBackSync is not in the react types
    const canGoBack = useMemo(() => nav?.canGoBackSync() ?? false, [nav]);

    const routerDirection: RouterDirection = useMemo(() => {
        return canGoBack ? 'back' : 'root';
    }, [canGoBack]);

    if (isMobile) {
        if (isPlatform('ios')) {
            return (
                <IonHeader className="bg-white px-4 border-b" ref={ref}>
                    {canHaveBackButton ? (
                        <Link
                            routerDirection={routerDirection}
                            routerLink="/"
                            className="p-1"
                        >
                            <ChevronLeftIcon className="h-6 w-6" />
                        </Link>
                    ) : (
                        <div className="w-6 h-6 m-1" />
                    )}
                    <IonTitle>{children}</IonTitle>
                </IonHeader>
            );
        } else {
            return (
                <IonHeader className="bg-white px-4 border-b" ref={ref}>
                    <div className="flex py-3">
                        {canHaveBackButton ? (
                            <Link
                                routerDirection={routerDirection}
                                routerLink="/"
                                className="p-1"
                            >
                                <ChevronLeftIcon className="h-6 w-6" />
                            </Link>
                        ) : (
                            <div className="w-6 h-6 m-1" />
                        )}
                        <IonTitle className="text-xl">{children}</IonTitle>
                    </div>
                </IonHeader>
            );
        }
    }

    return <></>;
};
