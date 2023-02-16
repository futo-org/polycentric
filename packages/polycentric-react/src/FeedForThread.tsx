import { useState, useEffect } from 'react';
import * as Base64 from '@borderless/base64';
import { Divider, Paper, LinearProgress } from '@mui/material';

import * as Core from 'polycentric-core';
import * as Post from './Post';
import * as ProfileUtil from './ProfileUtil';
import * as Feed from './Feed';
import * as Explore from './Explore';
import * as FeedState from './FeedState';

import './Standard.css';

export type FeedForThreadProps = {
    state: Core.DB.PolycentricState;
    feed: Core.Protocol.URLInfo;
};

export function FeedForThread(props: FeedForThreadProps) {
    const [feedItems, setFeedItems] = useState<Array<FeedState.FeedItem>>([]);

    const [replyItems, setReplyItems] = useState<Array<FeedState.FeedItem>>([]);

    const [loadingReplies, setLoadingReplies] = useState<boolean>(true);

    const loadPost = async (
        cancelContext: Core.CancelContext.CancelContext,
        cache: Explore.Cache,
    ): Promise<void> => {
        const pointer = {
            publicKey: props.feed.publicKey,
            writerId: props.feed.writerId!,
            sequenceNumber: props.feed.sequenceNumber!,
        };

        await FeedState.loadFeedItem(
            props.state,
            cancelContext,
            cache,
            pointer,
            0,
            (cb) => {
                setFeedItems((previous) => {
                    return cb(previous);
                });
            },
            async (item) => {
                return item;
            },
            (previous, item) => {
                return previous.concat([item]);
            },
        );
    };

    const loadReplies = async (
        cancelContext: Core.CancelContext.CancelContext,
        cache: Explore.Cache,
    ): Promise<void> => {
        const pointer = {
            publicKey: props.feed.publicKey,
            writerId: props.feed.writerId!,
            sequenceNumber: props.feed.sequenceNumber!,
        };

        const profile = await Core.DB.loadSpecificProfile(
            props.state,
            props.feed.publicKey,
        );

        if (profile === undefined) {
            return;
        }

        const addresses = profile.servers.map((address) => {
            return new TextDecoder().decode(address);
        });

        for (const address of addresses) {
            let replies;
            try {
                replies = await Core.APIMethods.loadReplies(address, pointer);
            } catch (err) {
                console.log('failed to load replies from: ' + address);

                continue;
            }

            await Core.Synchronization.saveBatch(
                props.state,
                replies.relatedEvents,
            );
            await Core.Synchronization.saveBatch(
                props.state,
                replies.resultEvents,
            );

            for (const event of replies.resultEvents) {
                const pointer = {
                    publicKey: event.authorPublicKey,
                    writerId: event.writerId,
                    sequenceNumber: event.sequenceNumber,
                };

                await FeedState.loadFeedItem(
                    props.state,
                    cancelContext,
                    cache,
                    pointer,
                    0,
                    (cb) => {
                        setReplyItems((previous) => {
                            return cb(previous);
                        });
                    },
                    async (item) => {
                        item.boost = undefined;
                        item.fromServer = address;
                        return item;
                    },
                    (previous, item) => {
                        return previous.concat([item]);
                    },
                );
            }
        }

        if (cancelContext.cancelled()) {
            return;
        }

        setLoadingReplies(false);
    };

    useEffect(() => {
        const cancelContext = new Core.CancelContext.CancelContext();
        const cache = new Explore.Cache();

        setFeedItems([]);
        setReplyItems([]);
        setLoadingReplies(true);

        loadPost(cancelContext, cache);
        loadReplies(cancelContext, cache);

        return () => {
            cancelContext.cancel();

            for (const item of feedItems) {
                item.dependencyContext.cleanup();
            }

            for (const item of replyItems) {
                item.dependencyContext.cleanup();
            }

            cache.free();
        };
    }, [props.feed]);

    return (
        <div>
            {feedItems.map(
                (item) =>
                    item.post && (
                        <Post.PostMemo
                            key={item.key}
                            state={props.state}
                            post={item.post}
                            showBoost={true}
                            depth={0}
                        />
                    ),
            )}

            <Paper
                elevation={4}
                className="standard_width"
                style={{
                    marginTop: '10px',
                    marginBottom: '10px',
                    padding: '5px',
                }}
            >
                <Divider>Reactions</Divider>
            </Paper>

            {replyItems.map(
                (item) =>
                    item.post && (
                        <Post.PostMemo
                            key={item.key}
                            state={props.state}
                            post={item.post}
                            showBoost={true}
                            depth={0}
                        />
                    ),
            )}

            {loadingReplies === true && (
                <div
                    style={{
                        width: '80%',
                        marginTop: '15px',
                        marginBottom: '15px',
                        marginLeft: 'auto',
                        marginRight: 'auto',
                    }}
                >
                    <LinearProgress />
                </div>
            )}
        </div>
    );
}
