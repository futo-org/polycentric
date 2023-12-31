import { IonContent } from '@ionic/react';
import { useMemo } from 'react';
import { useIsMobile } from '../../hooks/styleHooks';
import { DesktopHomeFeed } from './DesktopHomeFeed';
import { SwipeHomeFeed } from './SwipeHomeFeed';

export const HomeFeedPage = () => {
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
