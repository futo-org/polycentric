import { encode } from '@borderless/base64';
import { ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { FeedHookAdvanceFn, FeedHookData } from '../../../hooks/feedHooks';
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

    // we're going to use the sparsity of js arrays to our advantage here
    // TODO: figure out if we need to reset this on feed change
    const [batchNumberLoaded, setBatchNumberLoaded] = useState<Array<undefined | true>>([]);
    const indexLoaded = useRef<Array<undefined | boolean>>([]);

    const onBasicsLoaded = useCallback(
        (index: number) => {
            if (indexLoaded.current[index] === undefined) {
                indexLoaded.current[index] = true;
                // find the nearest multiple of batchLoadSize going down
                const low = Math.floor(index / batchLoadSize) * batchLoadSize;
                const high = low + batchLoadSize;
                // check if all the posts in the batch are loaded
                const allLoaded = indexLoaded.current
                    .slice(low, high)
                    .every((v) => v === true);

                if (allLoaded) {
                    const batchNum = Math.floor(index / batchLoadSize);
                    setBatchNumberLoaded((batchload) => {
                        const newBatchload = batchload.slice();
                        newBatchload[batchNum] = true;
                        return newBatchload;
                    });
                }
            }
        },
        [batchLoadSize],
    );

    return (
        <Virtuoso
            data={data}
            style={{ height: '100%' }}
            className="noscrollbar"
            itemContent={(index, data) => (
                <AutoBatchedPlaceholderPost
                    key={`${
                        data !== undefined
                            ? encode(data.signedEvent.signature)
                            : index
                    }-${
                        batchNumberLoaded[Math.floor(index / batchLoadSize)] !== true
                            ? 'placeholder'
                            : 'post'
                    }}`}
                    data={data}
                    index={index}
                    onBasicsLoaded={onBasicsLoaded}
                    showPlaceholders={
                        batchNumberLoaded[Math.floor(index / batchLoadSize)] !== true
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
