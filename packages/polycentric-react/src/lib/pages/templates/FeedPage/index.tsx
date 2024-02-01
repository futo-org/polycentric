import { ReactElement } from 'react';
import { InfiniteScrollWithRightCol } from '../../../components/layout/infinitescrollwithrightcol';
import { FeedHookAdvanceFn, FeedHookData } from '../../../hooks/feedHooks';

export const FeedPage = ({
    data,
    advanceFeed,
    rightCol,
}: {
    data: FeedHookData;
    advanceFeed: FeedHookAdvanceFn;
    rightCol: ReactElement;
}) => {
    return (
        <InfiniteScrollWithRightCol
            data={data}
            advanceFeed={advanceFeed}
            rightCol={rightCol}
        />
    );
};
