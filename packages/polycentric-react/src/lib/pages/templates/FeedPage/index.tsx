import { ReactElement } from 'react';
import PullToRefresh from 'react-pull-to-refresh';
import { InfiniteScrollWithRightCol } from '../../../components/layout/infinitescrollwithrightcol';
import { FeedHookAdvanceFn, FeedHookData } from '../../../hooks/feedHooks';
import { useIsMobile } from '../../../hooks/styleHooks';

export const FeedPage = ({
  data,
  advanceFeed,
  rightCol,
}: {
  data: FeedHookData;
  advanceFeed: FeedHookAdvanceFn;
  rightCol: ReactElement;
}) => {
  const isMobile = useIsMobile();

  const handleRefresh = async () => {
    await Promise.resolve(advanceFeed());
  };

  const content = (
    <InfiniteScrollWithRightCol
      data={data}
      advanceFeed={advanceFeed}
      rightCol={rightCol}
    />
  );

  return isMobile ? (
    <PullToRefresh onRefresh={handleRefresh}>{content}</PullToRefresh>
  ) : (
    content
  );
};
