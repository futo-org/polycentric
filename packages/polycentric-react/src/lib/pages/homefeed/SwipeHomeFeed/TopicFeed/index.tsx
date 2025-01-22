import { Feed } from '../../../../components/feed/Feed';
import { useTopicFeed } from '../../../../hooks/feedHooks';

export const TopicFeed = ({ topic }: { topic: string }) => {
    const [data, advanceFeed, nothingFound] = useTopicFeed(topic);
    
    return (
        <Feed
            data={data}
            advanceFeed={advanceFeed}
            nothingFound={nothingFound}
        />
    );
};
