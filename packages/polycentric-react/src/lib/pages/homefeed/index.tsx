/**
 * @fileoverview Home feed page with responsive mobile/desktop layouts.
 */

import { IonContent } from '@ionic/react';
import { useMemo } from 'react';
import { Page } from '../../app/routes';
import { useIsMobile } from '../../hooks/styleHooks';
import { DesktopHomeFeed } from './DesktopHomeFeed';
import { SwipeHomeFeed } from './SwipeHomeFeed';

// Home feed page with responsive mobile/desktop layouts
export const HomeFeedPage: Page = () => {
  const isMobile = useIsMobile();

  const feed = useMemo(() => {
    return isMobile ? <SwipeHomeFeed /> : <DesktopHomeFeed />;
  }, [isMobile]);

  return (
    <>
      <IonContent>{feed}</IonContent>
    </>
  );
};
