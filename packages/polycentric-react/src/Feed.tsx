import React, { useState, useEffect, useRef, memo } from 'react';
import * as Base64 from '@borderless/base64';
import { useParams } from 'react-router-dom';
import { useInView } from 'react-intersection-observer';
import { Paper, LinearProgress } from '@mui/material';
import * as Lodash from 'lodash';
import InfiniteScroll from 'react-infinite-scroll-component';
import Long from 'long';

import * as Core from 'polycentric-core';
import * as Post from './Post';
import ProfileCard from './ProfileCard';
import RecommendedProfiles from './RecommendedProfiles';
import * as ProfileUtil from './ProfileUtil';

import './Standard.css';

type ExploreItem = {
    initialPost: Post.DisplayablePost;
    dependencyContext: Core.DB.DependencyContext;
    key: string;
};

type KeyByAuthorByTime = {
    publicKey: Uint8Array;
    time: Number;
};

export function parseKeyByAuthorByTime(buffer: Uint8Array): KeyByAuthorByTime {
    if (buffer.byteLength !== 32 + 8) {
        throw new Error('buffer was not correct size');
    }

    const result: KeyByAuthorByTime = {
        publicKey: buffer.slice(0, 32),
        time: Long.fromBytesBE(
            Array.from(buffer.slice(32, 40)),
            true,
        ).toNumber(),
    };

    return result;
}

function eventGetKey(event: Core.Protocol.Event): string {
    return Base64.encode(
        Core.DB.makeStorageTypeEventKey(
            event.authorPublicKey,
            event.writerId,
            event.sequenceNumber,
        ),
    );
}

const FeedForTimelineMemo = memo(FeedForTimeline);

function FeedForTimeline(props: FeedProps) {
    const [exploreResults, setExploreResults] = useState<Array<ExploreItem>>(
        [],
    );

    const [loading, setLoading] = useState<boolean>(true);
    const [initial, setInitial] = useState<boolean>(true);
    const [complete, setComplete] = useState<boolean>(false);

    const iterator = useRef<Uint8Array | undefined>(undefined);
    const masterCancel = useRef<Core.Util.PromiseCancelControl>({
        cancelled: false,
    });

    const loadEvent = async (
        key: Uint8Array,
    ): Promise<ExploreItem | undefined> => {
        const profiles = new Map<string, ProfileUtil.DisplayableProfile>();

        const post = await Core.DB.tryLoadStorageEventByKey(props.state, key);

        if (post === undefined || post.event === undefined) {
            return undefined;
        }

        if (
            props.state.identity !== undefined &&
            Core.Util.blobsEqual(
                props.state.identity.publicKey,
                post.event.authorPublicKey,
            ) === false
        ) {
            const following = await Core.DB.levelAmFollowing(
                props.state,
                post.event.authorPublicKey,
            );

            if (following === false) {
                return undefined;
            }
        }

        const dependencyContext = new Core.DB.DependencyContext(props.state);

        const displayable = await Post.eventToDisplayablePost(
            props.state,
            profiles,
            post,
            dependencyContext,
        );

        if (displayable === undefined) {
            dependencyContext.cleanup();

            return undefined;
        }

        return {
            initialPost: displayable,
            dependencyContext: dependencyContext,
            key: eventGetKey(post.event),
        };
    };

    const handleLoad = async (
        cancelControl: Core.Util.PromiseCancelControl,
    ) => {
        if (cancelControl.cancelled) {
            return;
        }

        setLoading(true);

        const profiles = new Map<string, ProfileUtil.DisplayableProfile>();

        let filteredPosts: Array<ExploreItem> = [];

        while (true) {
            const LIMIT = 20;

            const postIndexes = await props.state.levelIndexPostByTime
                .iterator({
                    limit: LIMIT - filteredPosts.length,
                    reverse: true,
                    lt: iterator.current,
                })
                .all();

            if (cancelControl.cancelled) {
                return;
            }

            if (postIndexes.length < 1) {
                break;
            } else {
                const nextIterator = postIndexes[postIndexes.length - 1][0];
                iterator.current = nextIterator;
            }

            for (const [key, index] of postIndexes) {
                try {
                    const filtered = await loadEvent(index);

                    if (filtered === undefined) {
                        continue;
                    }

                    if (cancelControl.cancelled) {
                        for (const item of filteredPosts) {
                            item.dependencyContext.cleanup();
                        }

                        return;
                    }

                    filteredPosts.push(filtered);
                } catch (err) {
                    console.log(err);
                }
            }

            if (filteredPosts.length >= LIMIT) {
                break;
            }
        }

        if (cancelControl.cancelled) {
            for (const item of filteredPosts) {
                item.dependencyContext.cleanup();
            }

            return;
        }

        setExploreResults((old) => {
            const totalResults = old.concat(filteredPosts);
            console.log(
                'total',
                totalResults.length,
                'new',
                filteredPosts.length,
            );
            return totalResults;
        });

        if (filteredPosts.length === 0) {
            setComplete(true);
        }

        setLoading(false);
        setInitial(false);
    };

    const addEvent = async (
        key: Uint8Array,
        cancelControl: Core.Util.PromiseCancelControl,
    ): Promise<void> => {
        const filtered = await loadEvent(key);

        if (filtered === undefined) {
            console.log('add event filtered');
            return;
        }

        if (cancelControl.cancelled === true) {
            filtered.dependencyContext.cleanup();
        }

        setExploreResults((old) => {
            for (const item of old) {
                if (item.key === filtered.key) {
                    console.log('update already applied');
                    return old;
                }
            }

            return [filtered].concat(old);
        });
    };

    useEffect(() => {
        const cancelControl = {
            cancelled: false,
        };

        setExploreResults([]);
        setInitial(true);
        setComplete(false);
        iterator.current = undefined;
        masterCancel.current = cancelControl;

        const handlePut = (key: Uint8Array, value: Uint8Array) => {
            const updateParsed = Long.fromBytesBE(
                Array.from(key),
                true,
            ).toNumber();

            const iteratorParsed = Long.fromBytesBE(
                Array.from(key),
                true,
            ).toNumber();

            console.log('iter', iteratorParsed, 'other', updateParsed);

            if (updateParsed >= iteratorParsed) {
                console.log('within iterator', value);
                addEvent(value, cancelControl);
            }
        };

        props.state.levelIndexPostByTime.on('put', handlePut);

        handleLoad(cancelControl);

        return () => {
            props.state.levelIndexPostByTime.removeListener('put', handlePut);

            cancelControl.cancelled = true;

            for (const item of exploreResults) {
                item.dependencyContext.cleanup();
            }
        };
    }, []);

    return (
        <div
            style={{
                overflow: 'auto',
            }}
        >
            <InfiniteScroll
                dataLength={exploreResults.length}
                next={() => {
                    handleLoad(masterCancel.current);
                }}
                hasMore={complete === false}
                loader={
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
                }
                endMessage={<div></div>}
            >
                {exploreResults.map((item, index) => (
                    <Post.PostLoaderMemo
                        key={item.key}
                        state={props.state}
                        pointer={item.initialPost.pointer}
                        initialPost={item.initialPost}
                        dependencyContext={item.dependencyContext}
                        showBoost={true}
                        depth={0}
                    />
                ))}
            </InfiniteScroll>

            {initial === false && exploreResults.length === 0 && (
                <Paper
                    elevation={4}
                    style={{
                        padding: '15px',
                        textAlign: 'center',
                    }}
                >
                    <h3> There does not appear to be anything to here. </h3>
                </Paper>
            )}
        </div>
    );
}

const FeedForProfileMemo = memo(FeedForProfile);

type FeedForProfileProps = {
    state: Core.DB.PolycentricState;
    feed: Core.Protocol.URLInfo;
};

const MAX_KEY = new Uint8Array([255, 255, 255, 255, 255, 255, 255, 255]);
const MIN_KEY = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);

function FeedForProfile(props: FeedForProfileProps) {
    const [exploreResults, setExploreResults] = useState<Array<ExploreItem>>(
        [],
    );

    const [initial, setInitial] = useState<boolean>(true);
    const [complete, setComplete] = useState<boolean>(false);

    const loadingMore = useRef<boolean>(false);

    const iterator = useRef<Uint8Array>(
        Core.DB.appendBuffers(props.feed.publicKey, MAX_KEY),
    );

    const masterCancel = useRef<Core.Util.PromiseCancelControl>({
        cancelled: false,
    });

    const doBackfill = async (
        cancelControl: Core.Util.PromiseCancelControl,
    ) => {
        if (loadingMore.current == true) {
            return;
        }

        loadingMore.current = true;

        console.log('waiting on backfill');

        await Core.Synchronization.backfillClient(props.state, props.feed);

        if (cancelControl.cancelled) {
            return;
        }

        loadingMore.current = false;

        handleLoad(cancelControl);
    };

    const loadEvent = async (
        key: Uint8Array,
    ): Promise<ExploreItem | undefined> => {
        const profiles = new Map<string, ProfileUtil.DisplayableProfile>();

        const post = await Core.DB.tryLoadStorageEventByKey(props.state, key);

        if (post === undefined || post.event === undefined) {
            return undefined;
        }

        const dependencyContext = new Core.DB.DependencyContext(props.state);

        const displayable = await Post.eventToDisplayablePost(
            props.state,
            profiles,
            post,
            dependencyContext,
        );

        if (displayable === undefined) {
            dependencyContext.cleanup();

            return undefined;
        }

        return {
            initialPost: displayable,
            dependencyContext: dependencyContext,
            key: eventGetKey(post.event),
        };
    };

    const handleLoad = async (
        cancelControl: Core.Util.PromiseCancelControl,
    ) => {
        console.log('handle load');

        if (cancelControl.cancelled) {
            return;
        }

        let filteredPosts: Array<ExploreItem> = [];

        while (true) {
            const LIMIT = 20;

            const postIndexes = await props.state.levelIndexPostByAuthorByTime
                .iterator({
                    gte: Core.DB.appendBuffers(props.feed.publicKey, MIN_KEY),
                    lt: iterator.current,
                    limit: LIMIT - filteredPosts.length,
                    reverse: true,
                })
                .all();

            if (postIndexes.length < 1) {
                break;
            } else {
                const nextIterator = postIndexes[postIndexes.length - 1][0];
                iterator.current = nextIterator;
            }

            for (const [key, index] of postIndexes) {
                try {
                    const post = await loadEvent(index);

                    if (post === undefined) {
                        continue;
                    }

                    filteredPosts.push(post);

                    if (cancelControl.cancelled) {
                        for (const item of filteredPosts) {
                            item.dependencyContext.cleanup();
                        }

                        return;
                    }
                } catch (err) {
                    console.log(err);
                }
            }

            if (filteredPosts.length >= LIMIT) {
                break;
            }
        }

        if (cancelControl.cancelled) {
            for (const item of filteredPosts) {
                item.dependencyContext.cleanup();
            }

            return;
        }

        if (filteredPosts.length < 1) {
            const isFeedComplete = await Core.DB.isFeedComplete(
                props.state,
                props.feed.publicKey,
            );

            setComplete(isFeedComplete);

            if (isFeedComplete === false) {
                console.log('stalled');
                doBackfill(cancelControl);
            }
        } else {
            setExploreResults((old) => {
                const existing = new Set<string>();

                for (const item of old) {
                    existing.add(item.key);
                }

                const totalResults = [...old];

                for (const item of filteredPosts) {
                    if (existing.has(item.key) === false) {
                        totalResults.push(item);
                    }
                }

                console.log(
                    'total',
                    totalResults.length,
                    'new',
                    filteredPosts.length,
                );

                return totalResults
                    .sort((a, b) => {
                        const at = a.initialPost.unixMilliseconds;
                        const bt = b.initialPost.unixMilliseconds;

                        if (at < bt) {
                            return -1;
                        } else if (at > bt) {
                            return 1;
                        } else {
                            return 0;
                        }
                    })
                    .reverse();
            });
        }

        setInitial(false);
    };

    const addEvent = async (
        key: Uint8Array,
        cancelControl: Core.Util.PromiseCancelControl,
    ): Promise<void> => {
        const filtered = await loadEvent(key);

        if (filtered === undefined) {
            console.log('add event filtered');
            return;
        }

        if (cancelControl.cancelled === true) {
            filtered.dependencyContext.cleanup();
        }

        setExploreResults((old) => {
            for (const item of old) {
                if (item.key === filtered.key) {
                    console.log('update already applied');
                    return old;
                }
            }

            return [filtered]
                .concat(old)
                .sort((a, b) => {
                    const at = a.initialPost.unixMilliseconds;
                    const bt = b.initialPost.unixMilliseconds;

                    if (at < bt) {
                        return -1;
                    } else if (at > bt) {
                        return 1;
                    } else {
                        return 0;
                    }
                })
                .reverse();
        });
    };

    useEffect(() => {
        const cancelControl = {
            cancelled: false,
        };

        setExploreResults([]);
        setInitial(true);
        setComplete(false);
        iterator.current = Core.DB.appendBuffers(props.feed.publicKey, MAX_KEY);
        masterCancel.current = cancelControl;
        loadingMore.current = false;

        const handlePut = (key: Uint8Array, value: Uint8Array) => {
            const updateParsed = parseKeyByAuthorByTime(key);
            const iteratorParsed = parseKeyByAuthorByTime(iterator.current);

            if (
                Core.Util.blobsEqual(
                    updateParsed.publicKey,
                    iteratorParsed.publicKey,
                ) === false
            ) {
                return;
            }

            console.log(
                'iter',
                iteratorParsed.time,
                'other',
                updateParsed.time,
            );

            if (updateParsed.time < iteratorParsed.time) {
                console.log('outside of iterator');
                handleLoad(cancelControl);
            } else {
                console.log('within iterator');
                addEvent(value, cancelControl);
                handleLoad(cancelControl);
            }
        };

        props.state.levelIndexPostByAuthorByTime.on('put', handlePut);

        Core.Synchronization.loadServerHead(props.state, props.feed);

        handleLoad(cancelControl);

        return () => {
            cancelControl.cancelled = true;
            props.state.levelIndexPostByAuthorByTime.removeListener(
                'put',
                handlePut,
            );
        };
    }, [props.feed]);

    return (
        <div>
            <InfiniteScroll
                dataLength={exploreResults.length}
                next={() => {
                    handleLoad(masterCancel.current);
                }}
                hasMore={complete === false}
                loader={
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
                }
                endMessage={<div></div>}
            >
                {exploreResults.map((item, index) => (
                    <Post.PostLoaderMemo
                        key={item.key}
                        state={props.state}
                        pointer={item.initialPost.pointer}
                        initialPost={item.initialPost}
                        dependencyContext={item.dependencyContext}
                        showBoost={true}
                        depth={0}
                    />
                ))}
            </InfiniteScroll>

            {initial === false && exploreResults.length === 0 && (
                <Paper
                    elevation={4}
                    style={{
                        padding: '15px',
                        textAlign: 'center',
                    }}
                >
                    <h3> There does not appear to be anything to here. </h3>
                </Paper>
            )}
        </div>
    );
}

type FeedForThreadProps = {
    state: Core.DB.PolycentricState;
    feed: Core.Protocol.URLInfo;
};

type ExploreItem2 = {
    pointer: Core.Protocol.Pointer;
    initialPost: Post.DisplayablePost | undefined;
    dependencyContext: Core.DB.DependencyContext;
    key: string;
};

function FeedForThread(props: FeedForThreadProps) {
    const [exploreResults, setExploreResults] = useState<Array<ExploreItem2>>(
        [],
    );

    const loadPost = async (cancelControl: Core.Util.PromiseCancelControl) => {
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

        if (post !== undefined && post.event !== undefined) {
            const displayable = await Post.eventToDisplayablePost(
                props.state,
                profiles,
                post,
                dependencyContext,
            );

            if (displayable !== undefined) {
                const item = {
                    pointer: pointer,
                    initialPost: displayable,
                    dependencyContext: dependencyContext,
                    key: eventGetKey(post.event),
                };

                setExploreResults([item]);

                return;
            }
        }

        console.log('fallback');

        const item = {
            pointer: pointer,
            initialPost: undefined,
            dependencyContext: dependencyContext,
            key: Base64.encode(
                Core.DB.makeStorageTypeEventKey(
                    props.feed.publicKey,
                    props.feed.writerId!,
                    props.feed.sequenceNumber!,
                ),
            ),
        };

        setExploreResults([item]);
    };

    useEffect(() => {
        const cancelControl = {
            cancelled: false,
        };

        setExploreResults([]);

        loadPost(cancelControl);

        return () => {
            cancelControl.cancelled = true;

            for (const item of exploreResults) {
                item.dependencyContext.cleanup();
            }
        };
    }, [props.feed]);

    return (
        <div>
            {exploreResults.map((item, index) => (
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
        </div>
    );
}

type FeedProps = {
    state: Core.DB.PolycentricState;
};

export function Feed(props: FeedProps) {
    const { feed } = useParams();

    const [decodedFeed, setDecodedFeed] = useState<
        Core.Protocol.URLInfo | undefined
    >(undefined);

    useEffect(() => {
        window.scrollTo(0, 0);

        if (feed) {
            try {
                const decoded = Core.Protocol.URLInfo.decode(
                    new Uint8Array(Base64.decode(feed)),
                );

                setDecodedFeed(decoded);
            } catch (err) {
                console.log('failed to decode url');
            }
        } else {
            setDecodedFeed(undefined);
        }
    }, [feed]);

    return (
        <div
            className="standard_width"
            style={{
                position: 'relative',
            }}
        >
            {decodedFeed !== undefined && decodedFeed.writerId === undefined && (
                <div className="profilecard_position">
                    <ProfileCard
                        publicKey={decodedFeed.publicKey}
                        state={props.state}
                    />
                </div>
            )}

            <div className="recommendedcard_position">
                <RecommendedProfiles state={props.state} />
            </div>

            {decodedFeed === undefined && (
                <FeedForTimeline state={props.state} />
            )}

            {decodedFeed !== undefined &&
                decodedFeed.writerId === undefined && (
                    <FeedForProfile state={props.state} feed={decodedFeed} />
                )}

            {decodedFeed !== undefined &&
                decodedFeed.writerId !== undefined && (
                    <FeedForThread state={props.state} feed={decodedFeed} />
                )}
        </div>
    );
}

export default Feed;
