import { IonContent } from '@ionic/react';
import { useMemo } from 'react';
import { PostCompose } from '../../components/feed/Compose/PostCompose';
import { InfiniteScrollWithRightCol } from '../../components/layout/infinitescrollwithrightcol';
import { useFollowingFeed } from '../../hooks/feedHooks';

export const FollowingFeed = () => {
    const [data, advanceFeed] = useFollowingFeed();
    const composeComponent = useMemo(
        () => <PostCompose key="topfeedcompose" />,
        [],
    );
    return (
        <IonContent>
            <InfiniteScrollWithRightCol
                data={data}
                advanceFeed={advanceFeed}
                rightCol={undefined}
                topFeedComponent={composeComponent}
                bottomPadding={false}
            />
        </IonContent>
    );
};
