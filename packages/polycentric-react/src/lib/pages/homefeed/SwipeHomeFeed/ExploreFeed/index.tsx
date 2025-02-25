import { Feed } from '../../../../components/feed/Feed';
import { useExploreFeed } from '../../../../hooks/feedHooks';

export const ExploreFeed = () => {
    const [data, advanceFeed, nothingFound] = useExploreFeed();

    return (
        <Feed
            data={data}
            advanceFeed={advanceFeed}
            nothingFound={nothingFound}
        />
    );
};
