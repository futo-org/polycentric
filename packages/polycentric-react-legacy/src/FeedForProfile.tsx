import React, { useState, useEffect, useRef, memo } from 'react';
import { Paper, LinearProgress } from '@mui/material';
import Long from 'long';
import { useInView } from 'react-intersection-observer';
import * as SortedArrayFunctions from 'sorted-array-functions';

import * as Feed from './Feed';
import * as Core from '@polycentric/polycentric-core';
import * as Post from './Post';
import * as ProfileUtil from './ProfileUtil';
import * as Explore from './Explore';
import * as FeedState from './FeedState';
import * as Scroll from './scroll';

export const FeedForProfileMemo = memo(FeedForProfile);

export type FeedForProfileProps = {
    state: Core.DB.PolycentricState;
    feed: Core.Protocol.URLInfo;
};

function FeedForProfile(props: FeedForProfileProps) {
    const [ref, inView] = useInView();

    const [feedItems, setFeedItems] = useState<Array<FeedState.FeedItem>>(
        new Array(),
    );

    const [loading, setLoading] = useState<boolean>(true);
    const [initial, setInitial] = useState<boolean>(true);
    const [complete, setComplete] = useState<boolean>(false);
    const scrollPercent = Scroll.useScrollPercentage();

    const iterator = useRef<Uint8Array>(
        Core.DB.appendBuffers(props.feed.publicKey, Core.Keys.MAX_UINT64_KEY),
    );

    const cache = useRef<Explore.Cache>(new Explore.Cache());

    const masterCancel = useRef<Core.CancelContext.CancelContext>(
        new Core.CancelContext.CancelContext(),
    );

    const doBackfill = async (
        cancelContext: Core.CancelContext.CancelContext,
    ) => {
        console.info('waiting on backfill');
        await Core.Synchronization.backfillClient(props.state, props.feed);
        console.info('finished single backfill');
    };

    const addEvent = async (
        key: Uint8Array,
        cancelContext: Core.CancelContext.CancelContext,
    ): Promise<boolean> => {
        return await FeedState.loadFeedItem(
            props.state,
            cancelContext,
            cache.current,
            Core.Keys.keyToPointer(key),
            0,
            (cb) => {
                setFeedItems((previous) => {
                    return cb(previous);
                });
            },
            async (item) => {
                if (
                    Core.Util.blobsEqual(
                        item.event.authorPublicKey,
                        props.feed.publicKey,
                    ) === false
                ) {
                    return undefined;
                }

                return item;
            },
            (previous, item) => {
                const copy = [...previous];

                SortedArrayFunctions.add(copy, item, FeedState.compareItems);

                return copy;
            },
        );
    };

    const handleLoad = async (
        cancelContext: Core.CancelContext.CancelContext,
    ) => {
        console.info('handle load');

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

                    if (eventAdded) {
                        progress = true;
                    }
                } catch (err) {
                    console.warn(err);
                }
            }
        }

        if (cancelContext.cancelled()) {
            return;
        }

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

    useEffect(() => {
        const cancelContext = new Core.CancelContext.CancelContext();

        setFeedItems(new Array());
        setInitial(true);
        setLoading(false);
        setComplete(false);

        iterator.current = Core.DB.appendBuffers(
            props.feed.publicKey,
            Core.Keys.MAX_UINT64_KEY,
        );
        masterCancel.current = cancelContext;
        cache.current = new Explore.Cache();

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

        props.state.level.on('batch', handleBatch);

        Core.Synchronization.loadServerHead(props.state, props.feed);

        return () => {
            cancelContext.cancel();

            props.state.level.removeListener('batch', handleBatch);

            for (const item of feedItems) {
                item.dependencyContext.cleanup();
            }

            cache.current.free();
        };
    }, [props.state, props.feed]);

    useEffect(() => {
        if (loading === true || complete === true) {
            return;
        }

        const scroll = Scroll.calculateScrollPercentage();

        if (inView === true || initial === true || scroll >= 80) {
            /*
            console.info(
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
            {feedItems.map((item, index) => (
                <div
                    key={item.key}
                    ref={index === feedItems.length - 1 ? ref : undefined}
                >
                    {item.post && (
                        <Post.PostMemo
                            state={props.state}
                            post={item.post}
                            showBoost={true}
                            depth={0}
                        />
                    )}
                </div>
            ))}

            {initial === false && FeedState.noneVisible(feedItems) && (
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
