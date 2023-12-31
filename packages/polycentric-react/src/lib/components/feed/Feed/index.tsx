import { encode } from '@borderless/base64';
import { ReactElement, useEffect, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { FeedHookAdvanceFn, FeedHookData } from '../../../hooks/feedHooks';
import { Post } from '../Post';

export const Feed = ({
    data,
    advanceFeed,
    topFeedComponent,
}: {
    data: FeedHookData;
    advanceFeed: FeedHookAdvanceFn;
    scrollerKey?: string;
    topFeedComponent?: ReactElement;
}) => {
    useEffect(() => {
        advanceFeed();
    }, [advanceFeed]);

    const [windowHeight] = useState(window.innerHeight);

    return (
        <Virtuoso
            data={data}
            style={{ height: '100%' }}
            className="noscrollbar"
            itemContent={(index, data) => (
                <Post
                    key={
                        data !== undefined
                            ? encode(data.signedEvent.signature)
                            : index
                    }
                    data={data}
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
