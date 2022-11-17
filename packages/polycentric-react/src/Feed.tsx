import React, { useState, useEffect, useRef, memo } from 'react';
import * as Base64 from '@borderless/base64';
import { useParams } from 'react-router-dom';
import { Paper, LinearProgress } from '@mui/material';
import * as Lodash from 'lodash';
import InfiniteScroll from 'react-infinite-scroll-component';
import Long from 'long';
import { useInView } from 'react-intersection-observer';
import * as SortedArrayFunctions from 'sorted-array-functions';

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
        Core.Keys.pointerToKey({
            publicKey: event.authorPublicKey,
            writerId: event.writerId,
            sequenceNumber: event.sequenceNumber,
        }),
    );
}

const calculateScrollPercentage = (): number => {
    const h = document.documentElement;
    const b = document.body;
    const st = 'scrollTop';
    const sh = 'scrollHeight';

    return ((h[st] || b[st]) / ((h[sh] || b[sh]) - h.clientHeight)) * 100;
};

const FeedForTimelineMemo = memo(FeedForTimeline);

function compareExploreItems(b: ExploreItem, a: ExploreItem) {
    const at = a.initialPost.sortMilliseconds;
    const bt = b.initialPost.sortMilliseconds;

    if (at < bt) {
        return -1;
    } else if (at > bt) {
        return 1;
    } else {
        return 0;
    }
}

class FeedItems {
    itemKeys: Set<String>;
    items: Array<ExploreItem>;

    constructor() {
        this.itemKeys = new Set<String>();
        this.items = new Array<ExploreItem>();
    }
}

function FeedForTimeline(props: FeedProps) {
    const [ref, inView] = useInView();

    const [feedItems, setFeedItems] = useState<FeedItems>(new FeedItems());

    const [loading, setLoading] = useState<boolean>(true);
    const [initial, setInitial] = useState<boolean>(true);
    const [complete, setComplete] = useState<boolean>(false);
    const [scrollPercent, setScrollPercent] = useState<number>(0);

    const iterator = useRef<Uint8Array | undefined>(undefined);

    const masterCancel = useRef<Core.CancelContext.CancelContext>(
        new Core.CancelContext.CancelContext(),
    );

    const loadEvent = async (
        key: Uint8Array,
    ): Promise<ExploreItem | undefined> => {
        const pointer = Core.Keys.keyToPointer(key);

        if (
            props.state.identity !== undefined &&
            Core.Util.blobsEqual(
                props.state.identity.publicKey,
                pointer.publicKey,
            ) === false
        ) {
            const following = await Core.DB.levelAmFollowing(
                props.state,
                pointer.publicKey,
            );

            if (following === false) {
                return undefined;
            }
        }

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
        cancelContext: Core.CancelContext.CancelContext,
    ) => {
        if (cancelContext.cancelled()) {
            return;
        }

        setLoading(true);

        let progress = false;

        while (progress === false) {
            const LIMIT = 20;

            const postIndexes = await props.state.levelIndexPostByTime
                .iterator({
                    limit: LIMIT,
                    reverse: true,
                    lt: iterator.current,
                })
                .all();

            if (cancelContext.cancelled()) {
                return;
            }

            if (postIndexes.length < 1) {
                break;
            } else {
                const nextIterator = postIndexes[postIndexes.length - 1][0];
                iterator.current = nextIterator;
            }

            for (const [iterator, index] of postIndexes) {
                try {
                    const eventAdded = await addEvent(index, cancelContext);

                    if (cancelContext.cancelled()) {
                        return;
                    }

                    if (eventAdded === true) {
                        progress = true;
                    }
                } catch (err) {
                    console.log(err);
                }
            }
        }

        if (cancelContext.cancelled()) {
            return;
        }

        if (progress === false) {
            setComplete(true);
        }

        setLoading(false);
        setInitial(false);
    };

    const addEvent = async (
        key: Uint8Array,
        cancelContext: Core.CancelContext.CancelContext,
    ): Promise<boolean> => {
        const filtered = await loadEvent(key);

        if (filtered === undefined) {
            return false;
        }

        if (cancelContext.cancelled()) {
            filtered.dependencyContext.cleanup();

            return false;
        }

        setFeedItems((oldFeedItems) => {
            if (oldFeedItems.itemKeys.has(filtered.key) === true) {
                return oldFeedItems;
            }

            const nextFeedItems = new FeedItems();
            Object.assign(nextFeedItems, oldFeedItems);

            nextFeedItems.itemKeys.add(filtered.key);

            SortedArrayFunctions.add(
                nextFeedItems.items,
                filtered,
                compareExploreItems,
            );

            return nextFeedItems;
        });

        return true;
    };

    useEffect(() => {
        const cancelContext = new Core.CancelContext.CancelContext();

        setFeedItems(new FeedItems());
        setInitial(true);
        setLoading(false);
        setComplete(false);

        iterator.current = undefined;
        masterCancel.current = cancelContext;

        const handleBatch = (batch: Array<Core.DB.BinaryUpdateLevel>) => {
            for (const update of batch) {
                if (
                    update.type !== 'put' ||
                    update.sublevel !== props.state.levelIndexPostByTime
                ) {
                    continue;
                }

                const updateParsed = Long.fromBytesBE(
                    Array.from(update.key),
                    true,
                ).toNumber();

                const iteratorParsed =
                    iterator.current !== undefined
                        ? Long.fromBytesBE(
                              Array.from(iterator.current),
                              true,
                          ).toNumber()
                        : 0;

                if (updateParsed >= iteratorParsed) {
                    addEvent(update.value, cancelContext);
                }
            }
        };

        const updateScrollPercentage = () => {
            if (cancelContext.cancelled()) {
                return;
            }

            setScrollPercent(calculateScrollPercentage());
        };

        props.state.level.on('batch', handleBatch);
        window.addEventListener('scroll', updateScrollPercentage);

        return () => {
            props.state.level.removeListener('batch', handleBatch);
            window.removeEventListener('scroll', updateScrollPercentage);

            cancelContext.cancel();

            for (const item of feedItems.items) {
                item.dependencyContext.cleanup();
            }
        };
    }, [props.state]);

    useEffect(() => {
        if (loading === true || complete === true) {
            return;
        }

        const scroll = calculateScrollPercentage();

        if (inView === true || initial === true || scroll >= 80) {
            /*
            console.log(
                "calling load",
                "inView", inView,
                "initial", initial,
                "scrollPercent", scroll,
                "loading", loading,
                "complete", complete,
            );
            */

            handleLoad(masterCancel.current);
        }
    }, [props.state, inView, complete, scrollPercent, loading]);

    return (
        <div
            style={{
                overflow: 'auto',
            }}
        >
            {feedItems.items.map((item, index) => (
                <div
                    key={item.key}
                    ref={index === feedItems.items.length - 1 ? ref : undefined}
                >
                    <Post.PostLoaderMemo
                        state={props.state}
                        pointer={item.initialPost.pointer}
                        initialPost={item.initialPost}
                        dependencyContext={item.dependencyContext}
                        showBoost={true}
                        depth={0}
                    />
                </div>
            ))}

            {initial === false && feedItems.items.length === 0 && (
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

            {loading === true && (
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

const FeedForProfileMemo = memo(FeedForProfile);

type FeedForProfileProps = {
    state: Core.DB.PolycentricState;
    feed: Core.Protocol.URLInfo;
};

function FeedForProfile(props: FeedForProfileProps) {
    const [ref, inView] = useInView();

    const [feedItems, setFeedItems] = useState<FeedItems>(new FeedItems());

    const [loading, setLoading] = useState<boolean>(true);
    const [initial, setInitial] = useState<boolean>(true);
    const [complete, setComplete] = useState<boolean>(false);
    const [scrollPercent, setScrollPercent] = useState<number>(0);

    const iterator = useRef<Uint8Array>(
        Core.DB.appendBuffers(props.feed.publicKey, Core.Keys.MAX_UINT64_KEY),
    );

    const masterCancel = useRef<Core.CancelContext.CancelContext>(
        new Core.CancelContext.CancelContext(),
    );

    const doBackfill = async (
        cancelContext: Core.CancelContext.CancelContext,
    ) => {
        console.log('waiting on backfill');
        await Core.Synchronization.backfillClient(props.state, props.feed);
        console.log('finished single backfill');
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
        cancelContext: Core.CancelContext.CancelContext,
    ) => {
        console.log('handle load');

        if (cancelContext.cancelled()) {
            return;
        }

        setLoading(true);

        let progress = false;

        while (progress === false) {
            const LIMIT = 20;

            const postIndexes = await props.state.levelIndexPostByAuthorByTime
                .iterator({
                    gte: Core.DB.appendBuffers(
                        props.feed.publicKey,
                        Core.Keys.MIN_UINT64_KEY,
                    ),
                    lt: iterator.current,
                    limit: LIMIT,
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
                    const eventAdded = await addEvent(index, cancelContext);

                    if (cancelContext.cancelled()) {
                        return;
                    }

                    if (eventAdded === true) {
                        progress = true;
                    }
                } catch (err) {
                    console.log(err);
                }
            }
        }

        if (cancelContext.cancelled()) {
            return;
        }

        /*
        if (filteredPosts.length < 1) {
            const isFeedComplete = await Core.DB.isFeedComplete(
                props.state,
                props.feed.publicKey,
            );

            setComplete(isFeedComplete);

            if (isFeedComplete === false) {
                console.log('stalled');
                doBackfill(cancelContext);
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

                const addedCount = totalResults.length - old.length;

                console.log('total', totalResults.length, 'new', addedCount);

                if (addedCount === 0) {
                    console.log('added count was zero so doing backfill');

                    doBackfill(cancelContext);
                } else if (totalResults.length < LIMIT) {
                    console.log('not enough posts to fill render');

                    doBackfill(cancelContext);
                }

                return totalResults
                    .sort((a, b) => {
                        const at = a.initialPost.sortMilliseconds;
                        const bt = b.initialPost.sortMilliseconds;

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
        */

        if (progress === false) {
            const isFeedComplete = await Core.DB.isFeedComplete(
                props.state,
                props.feed.publicKey,
            );

            if (cancelContext.cancelled()) {
                return;
            }

            setComplete(isFeedComplete);
            setInitial(false);

            if (isFeedComplete === false) {
                await doBackfill(cancelContext);

                setLoading(false);
            } else {
                setLoading(false);
            }
        } else {
            setLoading(false);
            setInitial(false);
        }
    };

    const addEvent = async (
        key: Uint8Array,
        cancelContext: Core.CancelContext.CancelContext,
    ): Promise<boolean> => {
        const filtered = await loadEvent(key);

        if (filtered === undefined) {
            return false;
        }

        if (cancelContext.cancelled()) {
            filtered.dependencyContext.cleanup();

            return false;
        }

        setFeedItems((oldFeedItems) => {
            if (oldFeedItems.itemKeys.has(filtered.key) === true) {
                return oldFeedItems;
            }

            const nextFeedItems = new FeedItems();
            Object.assign(nextFeedItems, oldFeedItems);

            nextFeedItems.itemKeys.add(filtered.key);

            SortedArrayFunctions.add(
                nextFeedItems.items,
                filtered,
                compareExploreItems,
            );

            return nextFeedItems;
        });

        return true;
    };

    useEffect(() => {
        const cancelContext = new Core.CancelContext.CancelContext();

        setFeedItems(new FeedItems());
        setInitial(true);
        setLoading(false);
        setComplete(false);

        iterator.current = Core.DB.appendBuffers(
            props.feed.publicKey,
            Core.Keys.MAX_UINT64_KEY,
        );
        masterCancel.current = cancelContext;

        const handleBatch = (batch: Array<Core.DB.BinaryUpdateLevel>) => {
            for (const update of batch) {
                if (
                    update.type !== 'put' ||
                    update.sublevel !== props.state.levelIndexPostByAuthorByTime
                ) {
                    continue;
                }

                const updateParsed = Long.fromBytesBE(
                    Array.from(update.key),
                    true,
                ).toNumber();

                const iteratorParsed =
                    iterator.current !== undefined
                        ? Long.fromBytesBE(
                              Array.from(iterator.current),
                              true,
                          ).toNumber()
                        : 0;

                addEvent(update.value, cancelContext);
            }
        };

        const updateScrollPercentage = () => {
            if (cancelContext.cancelled()) {
                return;
            }

            setScrollPercent(calculateScrollPercentage());
        };

        props.state.level.on('batch', handleBatch);
        window.addEventListener('scroll', updateScrollPercentage);

        Core.Synchronization.loadServerHead(props.state, props.feed);

        return () => {
            cancelContext.cancel();

            props.state.level.removeListener('batch', handleBatch);

            window.removeEventListener('scroll', updateScrollPercentage);

            for (const item of feedItems.items) {
                item.dependencyContext.cleanup();
            }
        };
    }, [props.state, props.feed]);

    useEffect(() => {
        if (loading === true || complete === true) {
            return;
        }

        const scroll = calculateScrollPercentage();

        if (inView === true || initial === true || scroll >= 80) {
            /*
            console.log(
                "calling load",
                "inView", inView,
                "initial", initial,
                "scrollPercent", scroll,
                "loading", loading,
                "complete", complete,
            );
            */

            handleLoad(masterCancel.current);
        }
    }, [
        props.state,
        props.feed,
        inView,
        complete,
        scrollPercent,
        loading,
        initial,
    ]);

    return (
        <div>
            {feedItems.items.map((item, index) => (
                <div
                    key={item.key}
                    ref={index === feedItems.items.length - 1 ? ref : undefined}
                >
                    <Post.PostLoaderMemo
                        state={props.state}
                        pointer={item.initialPost.pointer}
                        initialPost={item.initialPost}
                        dependencyContext={item.dependencyContext}
                        showBoost={true}
                        depth={0}
                    />
                </div>
            ))}

            {initial === false && feedItems.items.length === 0 && (
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

            {loading === true && (
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
                    key: eventGetKey(post.event),
                };

                if (cancelContext.cancelled()) {
                    dependencyContext.cleanup();
                    return;
                }

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

        setExploreResults([item]);
    };

    useEffect(() => {
        const cancelContext = new Core.CancelContext.CancelContext();

        setExploreResults([]);

        loadPost(cancelContext);

        return () => {
            cancelContext.cancel();

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

            {decodedFeed !== undefined && decodedFeed.writerId === undefined && (
                <div className="recommendedcard_position">
                    <RecommendedProfiles state={props.state} />
                </div>
            )}

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
