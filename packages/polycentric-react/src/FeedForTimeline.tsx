import React, { useState, useEffect, useRef, memo } from 'react';
import { Paper, LinearProgress } from '@mui/material';
import Long from 'long';
import { useInView } from 'react-intersection-observer';
import * as SortedArrayFunctions from 'sorted-array-functions';

import * as Feed from './Feed';
import * as Core from 'polycentric-core';
import * as Post from './Post';
import * as ProfileUtil from './ProfileUtil';
import * as Explore from './Explore';
import * as FeedState from './FeedState';
import * as Scroll from './scroll';

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

export const FeedForTimelineMemo = memo(FeedForTimeline);

function FeedForTimeline(props: Feed.FeedProps) {
    const [ref, inView] = useInView();

    const [feedItems, setFeedItems] = useState<Array<FeedState.FeedItem>>(
        new Array(),
    );

    const [loading, setLoading] = useState<boolean>(true);
    const [initial, setInitial] = useState<boolean>(true);
    const [complete, setComplete] = useState<boolean>(false);
    const scrollPercent = Scroll.useScrollPercentage();

    const iterator = useRef<Uint8Array | undefined>(undefined);

    const cache = useRef<Explore.Cache>(new Explore.Cache());

    const masterCancel = useRef<Core.CancelContext.CancelContext>(
        new Core.CancelContext.CancelContext(),
    );

    const addEvent = async (
        key: Uint8Array,
        cancelContext: Core.CancelContext.CancelContext,
    ): Promise<boolean> => {
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
                return false;
            }
        }

        return await FeedState.loadFeedItem(
            props.state,
            cancelContext,
            cache.current,
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
                const copy = [...previous];

                SortedArrayFunctions.add(copy, item, FeedState.compareItems);

                return copy;
            },
        );
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

    useEffect(() => {
        const cancelContext = new Core.CancelContext.CancelContext();

        setFeedItems(new Array());
        setInitial(true);
        setLoading(false);
        setComplete(false);

        iterator.current = undefined;
        masterCancel.current = cancelContext;
        cache.current = new Explore.Cache();

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

        props.state.level.on('batch', handleBatch);

        return () => {
            props.state.level.removeListener('batch', handleBatch);

            cancelContext.cancel();

            for (const item of feedItems) {
                item.dependencyContext.cleanup();
            }

            cache.current.free();
        };
    }, [props.state]);

    useEffect(() => {
        if (loading === true || complete === true) {
            return;
        }

        const scroll = Scroll.calculateScrollPercentage();

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
            {feedItems.map((item, index) => (
                <div
                    key={item.key}
                    ref={index === feedItems.length - 1 ? ref : undefined}
                >
                    { item.post && (
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
