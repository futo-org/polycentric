import { IonHeader, IonTitle, RouterDirection, isPlatform } from '@ionic/react';

import { ChevronLeftIcon } from '@heroicons/react/24/outline';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useIsMobile } from '../../../hooks/styleHooks';
import { Link } from '../../util/link';

export const Header = ({
  children,
  canHaveBackButton = true,
  right,
}: {
  children?: React.ReactNode;
  canHaveBackButton?: boolean;
  right?: React.ReactNode;
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
    const baseClasses =
      'bg-white px-4 border-b text-black flex items-center justify-between';

    const BackButton = canHaveBackButton ? (
      <Link 
        routerDirection={routerDirection} 
        routerLink={canGoBack ? undefined : "/"} 
        className="p-1"
      >
        <ChevronLeftIcon className="h-6 w-6" />
      </Link>
    ) : (
      <div className="w-6 h-6 m-1" />
    );

    // iOS needs IonHeader children flat (no extra div) – we keep structure minimal
    if (isPlatform('ios')) {
      return (
        <IonHeader className={baseClasses} ref={ref}>
          <div className="flex items-center space-x-2">
            {BackButton}
            <IonTitle className="text-base text-black whitespace-nowrap">
              {children}
            </IonTitle>
          </div>
          {right}
        </IonHeader>
      );
    } else {
      return (
        <IonHeader className={baseClasses} ref={ref}>
          <div className="flex py-3 items-center space-x-2">
            {BackButton}
            <IonTitle className="text-xl text-black whitespace-nowrap">
              {children}
            </IonTitle>
          </div>
          {right}
        </IonHeader>
      );
    }
  }

  return <></>;
};
