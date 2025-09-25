/**
 * @fileoverview Explore feed component for mobile swipe navigation.
 */

import { Feed } from '../../../../components/feed/Feed';
import { useExploreFeed } from '../../../../hooks/feedHooks';

// Explore feed component for mobile swipe navigation
export const ExploreFeed = () => {
  const [data, advanceFeed, nothingFound] = useExploreFeed();

  return (
    <Feed data={data} advanceFeed={advanceFeed} nothingFound={nothingFound} />
  );
};
