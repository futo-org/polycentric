import { IonContent } from '@ionic/react';
import { useMemo } from 'react';
import { Page } from '../../app/router';
import { useIsMobile } from '../../hooks/styleHooks';
import { DesktopHomeFeed } from './DesktopHomeFeed';
import { SwipeHomeFeed } from './SwipeHomeFeed';

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
