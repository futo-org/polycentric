import {
    CancelContext,
    Models,
    Protocol,
    Queries,
    Store,
    Util,
} from '@polycentric/polycentric-core';
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
    const currentCancelContext = useRef<CancelContext.CancelContext>();
    const cursorRef = useRef<Store.IndexFeed.IndexFeedCursor | undefined>();

    const indexFeed = useMemo(() => {
        return processHandle.store().indexFeed;
    }, [processHandle]);

    const advance = useCallback(async () => {
        if (currentCancelContext.current !== undefined) {
            return;
        }

        const cancelContext = new CancelContext.CancelContext();
        currentCancelContext.current = cancelContext;

        let recieved = 0;
        do {
            const { cursor, items } = await indexFeed.query(
                batchSize,
                cursorRef.current,
            );

            if (cancelContext.cancelled()) {
                return;
            }

            cursorRef.current = cursor;
            const parsedEvents = items.map((signedEvent) => {
                const event = Models.Event.fromBuffer(signedEvent.event);
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
            cursorRef.current !== undefined &&
            recieved < batchSize &&
            !cancelContext.cancelled()
        );

        currentCancelContext.current = undefined;
    }, [indexFeed, cursorRef, batchSize]);

    return [state, advance];
}
