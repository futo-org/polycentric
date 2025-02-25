import { useMemo } from 'react';
import { PostCompose } from '../../../components/feed/Compose/PostCompose';
import { InfiniteScrollWithRightCol } from '../../../components/layout/infinitescrollwithrightcol';
import { useExploreFeed } from '../../../hooks/feedHooks';

export const DesktopHomeFeed = () => {
  const [data, advanceFeed, nothingFound] = useExploreFeed();
  const composeComponent = useMemo(
    () => <PostCompose key="topfeedcompose" />,
    [],
  );
  return (
    <InfiniteScrollWithRightCol
      data={data}
      advanceFeed={advanceFeed}
      nothingFound={nothingFound}
      nothingFoundMessage="No posts found"
      rightCol={<div />}
      topFeedComponent={composeComponent}
    />
  );
};
