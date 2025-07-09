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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useModeration } from './moderationHooks';
import { useProcessHandleManager } from './processHandleManagerHooks';
import {
  ParsedEvent,
  useIndex,
  useQueryCRDTSet,
  useQueryCursor,
  useQueryManager,
  useQueryReferenceEventFeed,
} from './queryHooks';

export type FeedItem =
  | ParsedEvent<Protocol.Post>
  | ParsedEvent<Protocol.Claim>
  | ParsedEvent<Protocol.Vouch>;

export type FeedHookData = ReadonlyArray<FeedItem | undefined>;
export type FeedHookAdvanceFn = () => void;

export type FeedHook = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => [FeedHookData, FeedHookAdvanceFn, boolean?];

const decodePost = (e: Models.Event.Event) => Protocol.Post.decode(e.content);

export const useAuthorFeed: FeedHook = (system: Models.PublicKey.PublicKey) => {
  // Keep separate hooks for each content type
  const [posts, advancePosts] = useIndex(
    system,
    Models.ContentType.ContentTypePost,
    Protocol.Post.decode,
  );

  const [claims, advanceClaims] = useIndex(
    system,
    Models.ContentType.ContentTypeClaim,
    Protocol.Claim.decode,
  );

  const [vouches, advanceVouches] = useIndex(
    system,
    Models.ContentType.ContentTypeVouch,
    Protocol.Vouch.decode,
  );

  // Combine for display only after each type has been properly synchronized
  const allItems = useMemo(() => {
    const items = [...posts, ...claims, ...vouches].filter(
      (item) => item !== undefined,
    );
    items.sort((a, b) => {
      if (!a?.event?.unixMilliseconds || !b?.event?.unixMilliseconds) return 0;
      return (
        b.event.unixMilliseconds.toNumber() -
        a.event.unixMilliseconds.toNumber()
      );
    });
    return items;
  }, [posts, claims, vouches]);

  // Advance all content types independently
  const advance = useCallback(() => {
    advancePosts();
    advanceClaims();
    advanceVouches();
  }, [advancePosts, advanceClaims, advanceVouches]);

  return [allItems, advance, false];
};

export const useExploreFeed: FeedHook = () => {
  const queryManager = useQueryManager();
  const { moderationLevels } = useModeration();

  const { processHandle } = useProcessHandleManager();
  const system = useMemo(() => processHandle.system(), [processHandle]);

  const [blockedTopicEvents, advanceBlockedTopics] = useQueryCRDTSet(
    system,
    Models.ContentType.ContentTypeBlockTopic,
    100,
  );

  // load initial blocked topics
  useEffect(() => {
    if (system) {
      advanceBlockedTopics();
    }
  }, [advanceBlockedTopics, system]);

  const blockedTopics = useMemo(() => {
    return blockedTopicEvents
      .filter((e) => e.lwwElementSet?.value)
      .map((e) => Util.decodeText(e.lwwElementSet!.value));
  }, [blockedTopicEvents]);

  const loadCallback = useMemo(
    () =>
      Queries.QueryCursor.makeGetExploreCallback(
        queryManager.processHandle,
        moderationLevels,
      ),
    [queryManager.processHandle, moderationLevels],
  );

  // Filter out posts referencing blocked topics
  const [data, advance, nothingFound] = useQueryCursor(
    loadCallback,
    decodePost,
  );

  const blockedSet = useMemo(() => new Set(blockedTopics), [blockedTopics]);

  const filteredData = useMemo(() => {
    return data.filter((item) => {
      if (!item) return true;

      // Filter out comments (posts that reference other posts)
      const references = item.event.references ?? [];
      const hasPostReference = references.some((ref) =>
        ref.referenceType.eq(2),
      );
      if (hasPostReference) return false;

      // Filter out blocked topics
      for (const ref of references) {
        try {
          const text = Util.decodeText(ref.reference);
          if (blockedSet.has(text)) return false;
        } catch (_) {
          continue;
        }
      }
      return true;
    });
  }, [data, blockedSet]);

  return [filteredData, advance, nothingFound];
};

const makeGetSearchCallbackWithMinQueryLength = (
  searchQuery: string,
  searchType: APIMethods.SearchType,
  minQueryLength: number,
) => {
  if (searchQuery.length < minQueryLength) {
    return async () => Models.ResultEventsAndRelatedEventsAndCursor.fromEmpty();
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
): [FeedItem[], () => void, boolean, number] => {
  const queryManager = useQueryManager();
  const [backwardsChain, setBackwardsChain] = useState<FeedItem[]>([]);

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
      callback?: (
        signedEvent: ParsedEvent<Protocol.Post | Protocol.Claim>,
      ) => void,
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
          let parsed;
          try {
            parsed = event.contentType.eq(Models.ContentType.ContentTypePost)
              ? Protocol.Post.decode(event.content)
              : Protocol.Claim.decode(event.content);
          } catch (error) {
            console.error('Failed to decode content:', error);
            return;
          }

          const parsedEvent = new ParsedEvent(signedEvent, event, parsed);

          setBackwardsChain((backwardsChain) => {
            const duplicate = backwardsChain.find((backwardsEvent) =>
              Models.SignedEvent.equal(backwardsEvent.signedEvent, signedEvent),
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

          const postReference = signedEvent.event.references.find((ref) =>
            ref.referenceType.eq(2),
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
): [FeedItem[], () => void, boolean] {
  const { processHandle } = useProcessHandleManager();
  const [state, setState] = useState<FeedItem[]>([]);
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

        let received = 0;
        do {
          const result = await indexFeed.query(batchSize, cursor);

          if (cancelContext.cancelled()) {
            return;
          }

          cursor = result.cursor;

          const parsedEvents = result.items
            .map((signedEvent) => {
              const event = Models.Event.fromBuffer(signedEvent.event);

              try {
                if (event.contentType.eq(Models.ContentType.ContentTypePost)) {
                  return new ParsedEvent<Protocol.Post>(
                    signedEvent,
                    event,
                    Protocol.Post.decode(event.content),
                  );
                } else if (
                  event.contentType.eq(Models.ContentType.ContentTypeClaim)
                ) {
                  return new ParsedEvent<Protocol.Claim>(
                    signedEvent,
                    event,
                    Protocol.Claim.decode(event.content),
                  );
                }
              } catch (error) {
                console.error('Failed to decode event:', error);
              }
              return undefined;
            })
            .filter((event): event is FeedItem => event !== undefined);

          received += parsedEvents.length;
          setState((state) => {
            const newState = state.concat(parsedEvents);
            return newState.sort((a, b) => {
              if (!a?.event?.unixMilliseconds || !b?.event?.unixMilliseconds)
                return 0;
              return (
                b.event.unixMilliseconds.toNumber() -
                a.event.unixMilliseconds.toNumber()
              );
            });
          });
        } while (
          cursor !== undefined &&
          received < batchSize &&
          !cancelContext.cancelled()
        );

        finished = cursor === undefined;

        if (finished && received === 0) {
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

export function useLikesFeed(
  system: Models.PublicKey.PublicKey,
): [FeedHookData, () => Promise<void>, boolean] {
  const [opinions, loadMore] = useIndex<Protocol.LWWElement>(
    system,
    Models.ContentType.ContentTypeOpinion,
    Protocol.LWWElement.decode,
    30, // Batch size
  );

  const queryManager = useQueryManager();
  const [posts, setPosts] = useState<FeedHookData>([]);
  const processedOpinions = useRef(new Set<string>());
  const [allLoaded] = useState(false);

  useEffect(() => {
    opinions.forEach((opinion) => {
      if (!opinion?.event?.references?.[0]) return;

      const opinionKey = opinion.event.references[0].reference.toString();
      if (processedOpinions.current.has(opinionKey)) return;

      processedOpinions.current.add(opinionKey);

      if (
        !Models.Opinion.equal(
          opinion.event.lwwElement?.value as Models.Opinion.Opinion,
          Models.Opinion.OpinionLike,
        )
      )
        return;

      // Safely decode the pointer reference. There are some cases (e.g. when the
      // liked post was created on a remote server that this server has not yet
      // synced with) where the reference may be malformed or incomplete. In
      // those situations `Models.Pointer.fromProto` will throw – previously
      // crashing the entire React render tree. We catch that error and simply
      // ignore the opinion until the data becomes available, logging for
      // debugging purposes.

      let pointer: Models.Pointer.Pointer | undefined;
      try {
        pointer = Models.Pointer.fromProto(
          Protocol.Pointer.decode(opinion.event.references[0].reference),
        );
      } catch (err) {
        console.warn('Skipping opinion with invalid pointer:', err);
        return; // Skip this opinion – nothing else we can do right now.
      }

      if (!pointer) return;

      queryManager.queryEvent.query(
        pointer.system,
        pointer.process,
        pointer.logicalClock,
        (signedEvent) => {
          if (!signedEvent) return;

          try {
            const event = Models.Event.fromBuffer(signedEvent.event);

            // Check if this is a valid post event that hasn't been deleted
            if (!event.contentType.eq(Models.ContentType.ContentTypePost))
              return;

            if (!event.content || event.content.length === 0) return;

            try {
              const post = Protocol.Post.decode(event.content);
              if (!post || !post.content) return;

              setPosts((prev) => [
                ...prev,
                new ParsedEvent(signedEvent, event, post),
              ]);
            } catch (decodeError) {
              console.error('Failed to decode post content:', decodeError);
              return;
            }
          } catch (error) {
            console.error('Failed to process event:', error);
            return;
          }
        },
      );
    });
  }, [opinions, queryManager]);

  const advanceOpinions = useCallback(async () => {
    if (!allLoaded) {
      await loadMore();
    }
  }, [loadMore, allLoaded]);

  return [posts, advanceOpinions, allLoaded];
}
