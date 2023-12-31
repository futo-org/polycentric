import { ReactElement } from 'react';
import { InfiniteScrollWithRightCol } from '../../../components/layout/infinitescrollwithrightcol';
import { FeedHookAdvanceFn, FeedHookData } from '../../../hooks/feedHooks';

export const FeedPage = ({
    data,
    advanceFeed,
    leftCol,
}: {
    data: FeedHookData;
    advanceFeed: FeedHookAdvanceFn;
    leftCol: ReactElement;
}) => {
    return (
        <InfiniteScrollWithRightCol
            data={data}
            advanceFeed={advanceFeed}
            leftCol={leftCol}
        />
    );
};
