import {
    CancelContext,
    Models,
    Protocol,
    Queries,
    Store,
    Util,
} from '@polycentric/polycentric-core';
import AsyncLock from 'async-lock';
import Long from 'long';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProcessHandleManager } from './processHandleManagerHooks';
import {
    ParsedEvent,
    useIndex,
    useQueryCursor,
    useQueryManager,
    useQueryReferenceEventFeed,
} from './queryHooks';

export type FeedHookData = ReadonlyArray<
    ParsedEvent<Protocol.Post> | undefined
>;
export type FeedHookAdvanceFn = () => void;

export type FeedHook = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...args: any[]
) => [FeedHookData, FeedHookAdvanceFn, boolean?];

export const useAuthorFeed: FeedHook = (system: Models.PublicKey.PublicKey) => {
    return useIndex(
        system,
        Models.ContentType.ContentTypePost,
        Protocol.Post.decode,
    );
};

export const useExploreFeed: FeedHook = () => {
    const loadCallback = useMemo(
        () => Queries.QueryCursor.makeGetExploreCallback(),
        [],
    );
    return useQueryCursor(loadCallback, Protocol.Post.decode);
};

export const useSearchFeed: FeedHook = (searchQuery: string) => {
    const loadCallback = useMemo(
        () => Queries.QueryCursor.makeGetSearchCallback(searchQuery),
        [searchQuery],
    );
    const [data, advanceFn, loaded] = useQueryCursor(
        loadCallback,
        Protocol.Post.decode,
    );

    return loaded ? [data, advanceFn] : [[undefined], advanceFn];
};

const commentFeedRequestEvents = {
    fromType: Models.ContentType.ContentTypePost,
    countLwwElementReferences: [],
    countReferences: [],
};
const emptyArray: [] = [];

export const useReferenceFeed = (
    reference?: Protocol.Reference,
    extraByteReferences?: Uint8Array[],
) => {
    return useQueryReferenceEventFeed(
        Protocol.Post.decode,
        reference,
        commentFeedRequestEvents,
        emptyArray,
        emptyArray,
        extraByteReferences,
    );
};

export const useTopicFeed = (
    topic: string,
    alternateTopicRepresentations?: string[],
) => {
    const reference = useMemo(() => {
        return Models.bufferToReference(Util.encodeText(topic));
    }, [topic]);

    const extraByteReferences = useMemo(() => {
        return alternateTopicRepresentations?.map((topic) =>
            Util.encodeText(topic),
        );
    }, [alternateTopicRepresentations]);

    return useReferenceFeed(reference, extraByteReferences);
};

export const useCommentFeed = (
    post?: Models.SignedEvent.SignedEvent,
): [ParsedEvent<Protocol.Post>[], () => void, boolean, number] => {
    const queryManager = useQueryManager();
    const [backwardsChain, setBackwardsChain] = useState<
        ParsedEvent<Protocol.Post>[]
    >([]);

    const pointer = useMemo(() => {
        if (!post) {
            return undefined;
        }
        return Models.signedEventToPointer(post);
    }, [post]);

    const fetchPost = useCallback(
        (
            system: Models.PublicKey.PublicKey,
            process: Models.Process.Process,
            logicalClock: Long,
            cancelContext: CancelContext.CancelContext,
            callback?: (signedEvent: ParsedEvent<Protocol.Post>) => void,
        ) => {
            queryManager.queryEvent.query(
                system,
                process,
                logicalClock,
                (signedEvent) => {
                    if (!signedEvent || cancelContext.cancelled()) {
                        return;
                    }

                    const event = Models.Event.fromBuffer(signedEvent.event);
                    const parsed = Protocol.Post.decode(event.content);

                    const parsedEvent = new ParsedEvent(
                        signedEvent,
                        event,
                        parsed,
                    );

                    setBackwardsChain((backwardsChain) => {
                        const duplicate = backwardsChain.find(
                            (backwardsEvent) =>
                                Models.SignedEvent.equal(
                                    backwardsEvent.signedEvent,
                                    signedEvent,
                                ),
                        );

                        if (duplicate != null) return backwardsChain;

                        return [parsedEvent, ...backwardsChain];
                    });

                    callback?.(parsedEvent);
                },
            );
        },
        [queryManager],
    );

    useEffect(() => {
        if (!pointer) {
            return;
        }

        const cancelContext = new CancelContext.CancelContext();

        const fetchAndPrepend = (pointer: Models.Pointer.Pointer) => {
            fetchPost(
                pointer.system,
                pointer.process,
                pointer.logicalClock,
                cancelContext,
                (signedEvent) => {
                    if (cancelContext.cancelled()) return;

                    const postReference = signedEvent.event.references.find(
                        (ref) => ref.referenceType.eq(2),
                    );
                    if (postReference) {
                        const postPointer = Models.Pointer.fromProto(
                            Protocol.Pointer.decode(postReference.reference),
                        );
                        fetchAndPrepend(postPointer);
                    }
                },
            );
        };

        fetchAndPrepend(pointer);

        return () => {
            cancelContext.cancel();
            setBackwardsChain([]);
        };
    }, [pointer, queryManager, fetchPost]);

    const reference = useMemo(() => {
        if (!pointer) {
            return undefined;
        }
        return Models.pointerToReference(pointer);
    }, [pointer]);

    const [comments, advance] = useReferenceFeed(reference);

    const prependCount = useMemo(
        () => (backwardsChain.length > 0 ? backwardsChain.length - 1 : 0),
        [backwardsChain],
    );

    const all = useMemo(
        () => [...backwardsChain, ...comments],
        [backwardsChain, comments],
    );

    return [all, advance, true, prependCount];
};

export function useFollowingFeed(
    batchSize = 10,
): [ParsedEvent<Protocol.Post>[], () => void] {
    const { processHandle } = useProcessHandleManager();
    const [state, setState] = useState<ParsedEvent<Protocol.Post>[]>([]);
    const [advance, setAdvance] = useState<() => void>(() => () => {});

    useEffect(() => {
        const cancelContext = new CancelContext.CancelContext();
        const indexFeed = processHandle.store().indexFeed;
        let cursor: Store.IndexFeed.IndexFeedCursor | undefined = undefined;
        let finished = false;
        const lock = new AsyncLock();

        const adv = async () => {
            await lock.acquire('', async (): Promise<void> => {
                if (finished === true || cancelContext.cancelled()) return;

                let recieved = 0;
                do {
                    const result = await indexFeed.query(batchSize, cursor);

                    if (cancelContext.cancelled()) {
                        return;
                    }

                    cursor = result.cursor;

                    const parsedEvents = result.items.map((signedEvent) => {
                        const event = Models.Event.fromBuffer(
                            signedEvent.event,
                        );
                        const parsed = Protocol.Post.decode(event.content);

                        return new ParsedEvent<Protocol.Post>(
                            signedEvent,
                            event,
                            parsed,
                        );
                    });
                    recieved += parsedEvents.length;
                    setState((state) => {
                        return state.concat(parsedEvents);
                    });
                } while (
                    cursor !== undefined &&
                    recieved < batchSize &&
                    !cancelContext.cancelled()
                );

                finished = cursor === undefined;

                return;
            });
        };
        setAdvance(() => adv);

        return () => {
            cancelContext.cancel();
            setAdvance(() => () => {});
            setState([]);
        };
    }, [processHandle, batchSize]);

    return [state, advance];
}
export const useBatchRenderFeed = (
    batchLoadSize: number,
    dataLength: number,
) => {
    // This is technically the same as using a map, but likely faster and more efficient in most browsers due to the operations we're doing
    const [renderableBatchMap, setRenderableBatchMap] = useState<
        Array<undefined | number | true>
    >([]);
    const indexLoaded = useRef<Array<undefined | boolean>>([]);

    const mountedRange = useRef({
        startIndex: 0,
        endIndex: 0,
    });

    const onBasicsLoaded = useCallback(
        (index: number) => {
            if (indexLoaded.current[index] === undefined) {
                // Check if we're not in the currently mounted range (data completes after we've scrolled away)
                if (
                    index < mountedRange.current.startIndex ||
                    index > mountedRange.current.endIndex
                ) {
                    return;
                }

                indexLoaded.current[index] = true;
                // find the nearest multiple of batchLoadSize going down
                const low = Math.floor(index / batchLoadSize) * batchLoadSize;
                const high = Math.min(low + batchLoadSize, dataLength);

                // check if all the posts in the batch are loaded
                const allLoaded = indexLoaded.current
                    .slice(low, high)
                    .every((v) => v === true);

                const batchNum = Math.floor(index / batchLoadSize);
                if (allLoaded) {
                    setRenderableBatchMap((newRenderableBatchMap) => {
                        const newMap = newRenderableBatchMap.slice();
                        newMap[batchNum] = true;
                        return newMap;
                    });
                }
            }
        },
        [batchLoadSize, dataLength],
    );

    const onRangeChange = useCallback(
        ({
            startIndex,
            endIndex,
        }: {
            startIndex: number;
            endIndex: number;
        }) => {
            const lowMountedBatch = Math.floor(startIndex / batchLoadSize);
            const highMountedBatch = Math.floor(endIndex / batchLoadSize);

            // Set a timeout on all posts in the viewport that aren't loaded yet
            setRenderableBatchMap((newRenderableBatchMap) => {
                let addedTimeout = false;
                const newMap = newRenderableBatchMap.slice();

                for (let i = lowMountedBatch; i <= highMountedBatch; i++) {
                    // If it's already loaded or there's already a timeout, skip
                    if (newMap[i] !== undefined) {
                        continue;
                    } else {
                        addedTimeout = true;
                    }

                    const timeout = window.setTimeout(() => {
                        const currentLowMountedBatch = Math.floor(
                            mountedRange.current.startIndex / batchLoadSize,
                        );
                        const currentHighMountedBatch = Math.floor(
                            mountedRange.current.endIndex / batchLoadSize,
                        );

                        const batchStillMounted =
                            currentLowMountedBatch <= i &&
                            i <= currentHighMountedBatch;

                        setRenderableBatchMap((laterRenderableBatchMap) => {
                            // Optimization: if it's already loaded skip the rerender
                            if (laterRenderableBatchMap[i] === true) {
                                return laterRenderableBatchMap;
                            }

                            const newLaterMap = laterRenderableBatchMap.slice();
                            newLaterMap[i] = batchStillMounted
                                ? true
                                : undefined;
                            return newLaterMap;
                        });
                    }, 1500);

                    newMap[i] = timeout;
                }
                return addedTimeout ? newMap : newRenderableBatchMap;
            });

            // For the posts that just scrolled out of our rendering range, mark them as unrenderable
            // Since they might unmount, if we scroll up and they're still marked as renderable after rendering the first time, they might have data flashing in

            // We know that the only posts that are loaded are the ones between the two ranges because we reject any post load callbacks that are out of range
            // When we scroll down, we want to unload the posts that are no longer in view
            if (startIndex > mountedRange.current.startIndex) {
                for (
                    let i = mountedRange.current.startIndex;
                    i < startIndex;
                    i++
                ) {
                    indexLoaded.current[i] = undefined;

                    if (i % batchLoadSize === 0) {
                        setRenderableBatchMap((batchload) => {
                            const newBatchload = batchload.slice();
                            const batchNum = Math.floor(i / batchLoadSize);
                            newBatchload[batchNum] = undefined;
                            return newBatchload;
                        });
                    }
                }
            }

            if (endIndex < mountedRange.current.endIndex) {
                for (let i = endIndex; i < mountedRange.current.endIndex; i++) {
                    indexLoaded.current[i] = undefined;

                    if (i % batchLoadSize === 0) {
                        setRenderableBatchMap((batchload) => {
                            const newBatchload = batchload.slice();
                            const batchNum = Math.floor(i / batchLoadSize);
                            newBatchload[batchNum] = undefined;
                            return newBatchload;
                        });
                    }
                }
            }

            mountedRange.current = {
                startIndex,
                endIndex,
            };
        },
        [batchLoadSize],
    );

    return useMemo(
        () => ({
            onBasicsLoaded,
            onRangeChange,
            renderableBatchMap,
        }),
        [onBasicsLoaded, onRangeChange, renderableBatchMap],
    );
};
