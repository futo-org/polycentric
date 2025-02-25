import { Feed } from '../../../../components/feed/Feed';
import { useFollowingFeed } from '../../../../hooks/feedHooks';

export const FollowingFeed = () => {
  const [data, advanceFeed, nothingFound] = useFollowingFeed();

  return (
    <Feed data={data} advanceFeed={advanceFeed} nothingFound={nothingFound} />
  );
};
