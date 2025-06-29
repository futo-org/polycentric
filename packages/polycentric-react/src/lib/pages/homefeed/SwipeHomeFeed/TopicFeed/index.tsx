import { Feed } from '../../../../components/feed/Feed';
import { useTopicFeed } from '../../../../hooks/feedHooks';
import { normalizeTopic } from '../../../../hooks/utilHooks';

export const TopicFeed = ({ topic }: { topic: string }) => {
  const normalized = normalizeTopic(topic);
  const [data, advanceFeed, nothingFound] = useTopicFeed(normalized);

  return (
    <Feed data={data} advanceFeed={advanceFeed} nothingFound={nothingFound} />
  );
};
