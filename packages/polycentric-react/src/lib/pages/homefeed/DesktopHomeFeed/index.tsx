import { useMemo } from 'react';
import { PostCompose } from '../../../components/feed/Compose/PostCompose';
import { InfiniteScrollWithRightCol } from '../../../components/layout/infinitescrollwithrightcol';
import { useExploreFeed } from '../../../hooks/feedHooks';

export const DesktopHomeFeed = () => {
    const [data, advanceFeed] = useExploreFeed();
    const composeComponent = useMemo(() => <PostCompose />, []);
    return (
        <InfiniteScrollWithRightCol
            data={data}
            advanceFeed={advanceFeed}
            leftCol={undefined}
            topFeedComponent={composeComponent}
        />
    );
};
