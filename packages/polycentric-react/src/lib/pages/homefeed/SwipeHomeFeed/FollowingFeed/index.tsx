/**
 * @fileoverview Following feed component for mobile swipe navigation.
 */

import { Feed } from '../../../../components/feed/Feed';
import { useFollowingFeed } from '../../../../hooks/feedHooks';

// Following feed component for mobile swipe navigation
export const FollowingFeed = () => {
  const [data, advanceFeed, nothingFound] = useFollowingFeed();

  return (
    <Feed data={data} advanceFeed={advanceFeed} nothingFound={nothingFound} />
  );
};
