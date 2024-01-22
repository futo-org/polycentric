import { encode } from '@borderless/base64';
import { ReactElement, useCallback, useEffect, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import {
    FeedHookAdvanceFn,
    FeedHookData,
    useBatchRenderFeed,
} from '../../../hooks/feedHooks';
import { Post, PostProps } from '../Post';

export const AutoBatchedPlaceholderPost = ({
    index,
    onBasicsLoaded,
    data,
    showPlaceholders,
    autoExpand,
}: {
    index: number;
    onBasicsLoaded: (i: number) => void;
    data: PostProps['data'];
    showPlaceholders: boolean;
    autoExpand?: boolean;
}) => {
    const onBasicsLoadedWithIndex = useCallback(() => {
        onBasicsLoaded(index);
    }, [index, onBasicsLoaded]);

    return (
        <Post
            data={data}
            onBasicsLoaded={onBasicsLoadedWithIndex}
            showPlaceholders={showPlaceholders}
            autoExpand={autoExpand}
        />
    );
};

export const Feed = ({
    data,
    advanceFeed,
    topFeedComponent,
    batchLoadSize = 5,
}: {
    data: FeedHookData;
    advanceFeed: FeedHookAdvanceFn;
    scrollerKey?: string;
    topFeedComponent?: ReactElement;
    batchLoadSize?: number;
}) => {
    useEffect(() => {
        advanceFeed();
    }, [advanceFeed]);

    const [windowHeight] = useState(window.innerHeight);
    const { renderableBatchMap, onBasicsLoaded, onRangeChange } =
        useBatchRenderFeed(batchLoadSize, data.length);

    return (
        <Virtuoso
            data={data}
            style={{ height: '100%' }}
            className="noscrollbar"
            rangeChanged={onRangeChange}
            itemContent={(index, data) => (
                <AutoBatchedPlaceholderPost
                    key={
                        data !== undefined
                            ? encode(data.signedEvent.signature)
                            : index
                    }
                    data={data}
                    index={index}
                    onBasicsLoaded={onBasicsLoaded}
                    showPlaceholders={
                        renderableBatchMap[
                            Math.floor(index / batchLoadSize)
                        ] !== true
                    }
                />
            )}
            overscan={{
                reverse: windowHeight * 5,
                main: windowHeight * 10,
            }}
            increaseViewportBy={{
                top: windowHeight / 2,
                bottom: windowHeight / 2,
            }}
            endReached={() => advanceFeed()}
            components={{
                Header: topFeedComponent ? () => topFeedComponent : undefined,
            }}
        />
    );
};
