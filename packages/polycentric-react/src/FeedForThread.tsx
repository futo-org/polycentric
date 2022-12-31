import { useState, useEffect } from 'react';
import * as Base64 from '@borderless/base64';
import { Divider, Paper, LinearProgress } from '@mui/material';

import * as Core from 'polycentric-core';
import * as Post from './Post';
import * as ProfileUtil from './ProfileUtil';
import * as Feed from './Feed';

import './Standard.css';

export type FeedForThreadProps = {
    state: Core.DB.PolycentricState;
    feed: Core.Protocol.URLInfo;
};

type FeedItem = {
    pointer: Core.Protocol.Pointer;
    initialPost: Post.DisplayablePost | undefined;
    dependencyContext: Core.DB.DependencyContext;
    key: string;
};

export function FeedForThread(props: FeedForThreadProps) {
    const [feedItems, setFeedItems] = useState<Array<FeedItem>>(
        [],
    );

    const [replyItems, setReplyItems] = useState<Array<FeedItem>>(
        [],
    );

    const [loadingReplies, setLoadingReplies] = useState<boolean>(true);

    const loadPost = async (
        cancelContext: Core.CancelContext.CancelContext,
    ): Promise<void> => {
        const profiles = new Map<string, ProfileUtil.DisplayableProfile>();

        const dependencyContext = new Core.DB.DependencyContext(props.state);

        const pointer = {
            publicKey: props.feed.publicKey,
            writerId: props.feed.writerId!,
            sequenceNumber: props.feed.sequenceNumber!,
        };

        dependencyContext.addDependency(pointer);

        const post = await Core.DB.tryLoadStorageEventByPointer(
            props.state,
            pointer,
        );

        if (post !== undefined && post.event === undefined) {
            return undefined;
        }

        if (cancelContext.cancelled()) {
            dependencyContext.cleanup();
            return;
        }

        if (post !== undefined && post.event !== undefined) {
            const displayable = await Post.eventToDisplayablePost(
                props.state,
                profiles,
                post,
                dependencyContext,
            );

            if (cancelContext.cancelled()) {
                dependencyContext.cleanup();
                return;
            }

            if (displayable !== undefined) {
                const item = {
                    pointer: pointer,
                    initialPost: displayable,
                    dependencyContext: dependencyContext,
                    key: Feed.eventGetKey(post.event),
                };

                if (cancelContext.cancelled()) {
                    dependencyContext.cleanup();
                    return;
                }

                setFeedItems([item]);

                return;
            }
        }

        const item = {
            pointer: pointer,
            initialPost: undefined,
            dependencyContext: dependencyContext,
            key: Base64.encode(
                Core.Keys.pointerToKey({
                    publicKey: props.feed.publicKey,
                    writerId: props.feed.writerId!,
                    sequenceNumber: props.feed.sequenceNumber!,
                }),
            ),
        };

        if (cancelContext.cancelled()) {
            dependencyContext.cleanup();
            return;
        }

        setFeedItems([item]);
    };

    const loadReplies = async (
        cancelContext: Core.CancelContext.CancelContext,
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
            const replies = await Core.APIMethods.loadReplies(
                address,
                pointer,
            );

            await Core.Synchronization.saveBatch(
                props.state,
                replies.relatedEvents,
            );
            await Core.Synchronization.saveBatch(
                props.state,
                replies.resultEvents,
            );

            for (const event of replies.resultEvents) {
                const dependencyContext = new Core.DB.DependencyContext(
                    props.state,
                );

                const displayable = await Post.tryLoadDisplayable(
                    props.state,
                    {
                        publicKey: event.authorPublicKey,
                        writerId: event.writerId,
                        sequenceNumber: event.sequenceNumber,
                    },
                    dependencyContext,
                );

                if (displayable === undefined) {
                    dependencyContext.cleanup();

                    continue;
                }

                displayable.boost = undefined;

                if (cancelContext.cancelled()) {
                    dependencyContext.cleanup();

                    return;
                }

                const item = {
                    pointer: pointer,
                    initialPost: displayable,
                    dependencyContext: dependencyContext,
                    key: Feed.eventGetKey(event),
                };

                setReplyItems((previous) => {
                    return previous.concat([item]);
                });
            }
        }

        if (cancelContext.cancelled()) {
            return;
        }

        setLoadingReplies(false);
    }

    useEffect(() => {
        const cancelContext = new Core.CancelContext.CancelContext();

        setFeedItems([]);
        setReplyItems([]);
        setLoadingReplies(true);

        loadPost(cancelContext);
        loadReplies(cancelContext);

        return () => {
            cancelContext.cancel();

            for (const item of feedItems) {
                item.dependencyContext.cleanup();
            }

            for (const item of replyItems) {
                item.dependencyContext.cleanup();
            }
        };
    }, [props.feed]);

    return (
        <div>
            {feedItems.map((item, index) => (
                <Post.PostLoaderMemo
                    key={item.key}
                    state={props.state}
                    pointer={item.pointer}
                    initialPost={item.initialPost}
                    dependencyContext={item.dependencyContext}
                    showBoost={true}
                    depth={0}
                />
            ))}
            
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

            {replyItems.map((item, index) => (
                <Post.PostLoaderMemo
                    key={item.key}
                    state={props.state}
                    pointer={item.pointer}
                    initialPost={item.initialPost}
                    dependencyContext={item.dependencyContext}
                    showBoost={true}
                    depth={0}
                />
            ))}

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

