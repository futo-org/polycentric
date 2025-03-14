import { encode } from '@borderless/base64';
import { ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { FeedHookAdvanceFn, FeedHookData } from '../../../hooks/feedHooks';
import { SpinLoader } from '../../util/SpinLoader';
import { Post } from '../Post';

export const Feed = ({
  data,
  advanceFeed,
  nothingFound,
  nothingFoundMessage,
  loadingSpinnerN,
  topFeedComponent,
}: {
  data: FeedHookData;
  advanceFeed: FeedHookAdvanceFn;
  nothingFound?: boolean;
  nothingFoundMessage?: string;
  loadingSpinnerN?: number;
  scrollerKey?: string;
  topFeedComponent?: ReactElement;
}) => {
  useEffect(() => {
    advanceFeed();
  }, [advanceFeed]);

  const windowHeight = useMemo(() => window.innerHeight, []);

  const [loadingIndicatorTimeoutReached, setLoadingIndicatorTimeoutReached] =
    useState(false);
  useEffect(() => {
    // Only show loading indicator if it takes more than 500ms to load anything
    const timeout = setTimeout(() => {
      setLoadingIndicatorTimeoutReached(true);
    }, 500);

    return () => {
      clearTimeout(timeout);
      setLoadingIndicatorTimeoutReached(false);
    };
  }, []);

  const Header = useCallback(() => {
    const showLoadingIndicator =
      loadingIndicatorTimeoutReached && data.length === 0 && !nothingFound;

    return (
      <>
        {topFeedComponent}

        {showLoadingIndicator && (
          <div className="w-full flex justify-center">
            <SpinLoader n={loadingSpinnerN} />
          </div>
        )}

        {
          // Show nothing found message if there are no posts and no loading indicator
          nothingFound && data.length === 0 && (
            <div className="w-full flex justify-center">
              <div className="p-20 text-center font-light text-gray-500">
                {nothingFoundMessage}
              </div>
            </div>
          )
        }
      </>
    );
  }, [
    loadingIndicatorTimeoutReached,
    data,
    nothingFound,
    topFeedComponent,
    loadingSpinnerN,
    nothingFoundMessage,
  ]);

  return (
    <Virtuoso
      data={data}
      style={{ height: '100%', width: '100%' }}
      className="noscrollbar"
      itemContent={(index, data) => (
        <Post
          key={data !== undefined ? encode(data.signedEvent.signature) : index}
          data={data}
        />
      )}
      overscan={{
        reverse: windowHeight,
        main: windowHeight,
      }}
      increaseViewportBy={{
        top: windowHeight / 2,
        bottom: windowHeight / 2,
      }}
      endReached={() => advanceFeed()}
      components={{
        Header,
      }}
    />
  );
};
