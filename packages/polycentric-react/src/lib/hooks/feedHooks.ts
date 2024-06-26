import {
    APIMethods,
    CancelContext,
    Models,
    Protocol,
    Queries,
    Store,
    Util,
} from '@polycentric/polycentric-core';
import AsyncLock from 'async-lock';
import Long from 'long';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

const decodePost = (e: Models.Event.Event) => Protocol.Post.decode(e.content);

export const useAuthorFeed: FeedHook = (system: Models.PublicKey.PublicKey) => {
    return useIndex(
        system,
        Models.ContentType.ContentTypePost,
        Protocol.Post.decode,
    );
};

export const useExploreFeed: FeedHook = () => {
    const queryManager = useQueryManager();

    const loadCallback = useMemo(
        () =>
            Queries.QueryCursor.makeGetExploreCallback(
                queryManager.processHandle,
            ),
        [queryManager.processHandle],
    );

    return useQueryCursor(loadCallback, decodePost);
};

const makeGetSearchCallbackWithMinQueryLength = (
    searchQuery: string,
    searchType: APIMethods.SearchType,
    minQueryLength: number,
) => {
    if (searchQuery.length < minQueryLength) {
        return async () =>
            Models.ResultEventsAndRelatedEventsAndCursor.fromEmpty();
    }

    return Queries.QueryCursor.makeGetSearchCallback(searchQuery, searchType);
};

export const useSearchPostsFeed: FeedHook = (searchQuery: string) => {
    const loadCallback = useMemo(() => {
        return makeGetSearchCallbackWithMinQueryLength(
            searchQuery,
            APIMethods.SearchType.Messages,
            3,
        );
    }, [searchQuery]);

    return useQueryCursor(loadCallback, decodePost);
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
): [ParsedEvent<Protocol.Post>[], () => void, boolean] {
    const { processHandle } = useProcessHandleManager();
    const [state, setState] = useState<ParsedEvent<Protocol.Post>[]>([]);
    const [advance, setAdvance] = useState<() => void>(() => () => {});
    const [nothingFound, setNothingFound] = useState(false);

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

                if (finished && recieved === 0) {
                    setNothingFound(true);
                }

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

    return [state, advance, nothingFound];
}
