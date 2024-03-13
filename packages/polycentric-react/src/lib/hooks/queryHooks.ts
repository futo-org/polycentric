import {
    APIMethods,
    CancelContext,
    Models,
    ProcessHandle,
    Protocol,
    Queries,
    Ranges,
    Util,
} from '@polycentric/polycentric-core';
import Long from 'long';
import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { useProcessHandleManager } from './processHandleManagerHooks';

// Since we create query managers based on the driver passed in, we set the query managers value at the root of the app.
// With this, it will never be undefined - but since typescript doesn't know that, we ignore the error.
export const QueryManagerContext =
    // @ts-ignore
    createContext<Queries.QueryManager.QueryManager>();

export function useQueryManager(): Queries.QueryManager.QueryManager {
    return useContext(QueryManagerContext);
}

export function useCRDTQuery<T>(
    system: Models.PublicKey.PublicKey | undefined,
    contentType: Models.ContentType.ContentType,
    parse: (buffer: Uint8Array) => T,
): T | null | undefined {
    const queryManager = useQueryManager();

    // null -> not yet found
    const [state, setState] = useState<T | null | undefined>(undefined);

    useEffect(() => {
        if (system !== undefined) {
            const cancelContext = new CancelContext.CancelContext();

            const unregister = queryManager.queryCRDT.query(
                system,
                contentType,
                (value) => {
                    if (cancelContext.cancelled()) {
                        return;
                    }

                    if (value.value) {
                        setState(parse(value.value));
                    } else {
                        setState(null);
                    }
                },
            );

            return () => {
                cancelContext.cancel();
                unregister();
                setState(undefined);
            };
        }
    }, [queryManager, system, contentType, parse]);

    return state;
}

export const useUsernameCRDTQuery = (
    system?: Models.PublicKey.PublicKey,
): string | undefined => {
    const username = useCRDTQuery(
        system,
        Models.ContentType.ContentTypeUsername,
        Util.decodeText,
    );
    return username ?? undefined;
};

export const useDescriptionCRDTQuery = (
    system?: Models.PublicKey.PublicKey,
) => {
    const description = useCRDTQuery(
        system,
        Models.ContentType.ContentTypeDescription,
        Util.decodeText,
    );
    return description ?? undefined;
};

export const useTextPublicKey = (
    system?: Models.PublicKey.PublicKey,
    maxLength?: number,
) => {
    return useMemo(() => {
        if (system === undefined) return undefined;

        const string = Models.PublicKey.toString(system);
        if (maxLength) {
            return string.slice(0, maxLength);
        } else {
            return string;
        }
    }, [system, maxLength]);
};

export const useSystemLink = (system: Models.PublicKey.PublicKey) => {
    const { processHandle } = useProcessHandleManager();

    const [link, setLink] = useState<string | undefined>(undefined);
    useEffect(() => {
        const cancelContext = new CancelContext.CancelContext();
        ProcessHandle.makeSystemLink(processHandle, system).then((link) => {
            if (cancelContext.cancelled()) {
                return;
            }
            setLink('/user/' + link);
        });
        return () => {
            cancelContext.cancel();
            setLink(undefined);
        };
    }, [processHandle, system]);

    return link;
};

export const useEventLink = (
    system?: Models.PublicKey.PublicKey,
    pointer?: Models.Pointer.Pointer,
) => {
    const { processHandle } = useProcessHandleManager();
    const [link, setLink] = useState<string | undefined>(undefined);
    useEffect(() => {
        if (system === undefined || pointer === undefined) {
            return;
        }

        const cancelContext = new CancelContext.CancelContext();
        ProcessHandle.makeEventLink(processHandle, system, pointer).then(
            (link) => {
                if (cancelContext.cancelled()) {
                    return;
                }
                setLink('/post/' + link);
            },
        );
        return () => {
            cancelContext.cancel();
            setLink(undefined);
        };
    }, [processHandle, system, pointer]);
    return link;
};

export const useTopicLink = (topic: string) => {
    return useMemo(() => {
        return '/t/' + encodeURIComponent(topic);
    }, [topic]);
};

export const useDateFromUnixMS = (unixMS: Long | undefined) => {
    return useMemo<Date | undefined>(() => {
        if (unixMS === undefined) {
            return undefined;
        }

        return new Date(unixMS.toNumber());
    }, [unixMS]);
};

export function useBlobQuery<T>(
    system: Models.PublicKey.PublicKey | undefined,
    process: Models.Process.Process | undefined,
    range: Ranges.IRange[] | undefined,
    parse: (buffer: Uint8Array) => T,
): T | undefined {
    const queryManager = useQueryManager();
    const [state, setState] = useState<T | undefined>(undefined);

    useEffect(() => {
        if (
            system !== undefined &&
            process !== undefined &&
            range !== undefined
        ) {
            const cancelContext = new CancelContext.CancelContext();

            const unregister = queryManager.queryBlob.query(
                system,
                process,
                range,
                (buffer: Uint8Array | undefined) => {
                    if (cancelContext.cancelled()) {
                        return;
                    }

                    if (buffer) {
                        setState(parse(buffer));
                    } else {
                        setState(undefined);
                    }
                },
            );

            return () => {
                cancelContext.cancel();
                unregister();
                setState(undefined);
            };
        }
    }, [system, process, range, queryManager, parse]);

    return state;
}

export class ParsedEvent<T> {
    signedEvent: Models.SignedEvent.SignedEvent;
    event: Models.Event.Event;
    value: T;

    constructor(
        signedEvent: Models.SignedEvent.SignedEvent,
        event: Models.Event.Event,
        value: T,
    ) {
        this.signedEvent = signedEvent;
        this.event = event;
        this.value = value;
    }
}

export type ClaimInfo<T> = {
    cell: Queries.QueryIndex.Cell;
    parsedEvent: ParsedEvent<T> | undefined;
};

export function useIndex<T>(
    system: Models.PublicKey.PublicKey,
    contentType: Models.ContentType.ContentType,
    parse: (buffer: Uint8Array) => T,
    batchSize = 30,
): [Array<ParsedEvent<T>>, () => void] {
    const queryManager = useQueryManager();

    const [state, setState] = useState<Array<ClaimInfo<T>>>([]);
    const [advance, setAdvance] = useState<
        ((batchSize: number) => void) | undefined
    >(undefined);

    useEffect(() => {
        const cancelContext = new CancelContext.CancelContext();

        const cb = (value: Queries.QueryIndex.CallbackParameters) => {
            if (cancelContext.cancelled()) {
                return;
            }

            const toAdd = value.add.map((cell) => {
                let parsedEvent: ParsedEvent<T> | undefined = undefined;

                if (cell.signedEvent !== undefined) {
                    const signedEvent = Models.SignedEvent.fromProto(
                        cell.signedEvent,
                    );
                    const event = Models.Event.fromBuffer(signedEvent.event);
                    const parsed = parse(event.content);

                    parsedEvent = new ParsedEvent<T>(
                        signedEvent,
                        event,
                        parsed,
                    );
                }

                return {
                    cell: cell,
                    parsedEvent: parsedEvent,
                };
            });

            setState((state) => {
                return state
                    .filter((x) => !value.remove.has(x.cell.key))
                    .concat(toAdd)
                    .sort((x, y) =>
                        Queries.QueryIndex.compareCells(y.cell, x.cell),
                    );
            });
        };

        const latestHandle = queryManager.queryIndex.query(
            system,
            contentType,
            cb,
        );
        setAdvance(() => (size: number) => latestHandle.advance(size));

        return () => {
            cancelContext.cancel();
            setState([]);
            setAdvance(undefined);
            latestHandle.unregister();
        };
    }, [queryManager, system, contentType, parse, batchSize]);

    const parsedEvents = useMemo(() => {
        return state
            .map((x) => x.parsedEvent)
            .filter((x) => x !== undefined) as ParsedEvent<T>[];
    }, [state]);

    const advanceCallback = useCallback(() => {
        advance?.(batchSize);
    }, [advance, batchSize]);

    return [parsedEvents, advanceCallback];
}

export const useQueryReferences = (
    system: Models.PublicKey.PublicKey | undefined,
    reference: Protocol.Reference | undefined,
    cursor?: Uint8Array,
    requestEvents?: Protocol.QueryReferencesRequestEvents,
    countLwwElementReferences?: Protocol.QueryReferencesRequestCountLWWElementReferences[],
    countReferences?: Protocol.QueryReferencesRequestCountReferences[],
    extraByteReferences?: Uint8Array[],
): Protocol.QueryReferencesResponse[] | undefined => {
    const [state, setState] = useState<
        Protocol.QueryReferencesResponse[] | undefined
    >(undefined);
    const { processHandle } = useProcessHandleManager();

    useEffect(() => {
        if (system === undefined || reference === undefined) return;

        const cancelContext = new CancelContext.CancelContext();

        const fetchQueryReferences = async () => {
            try {
                const systemState = await processHandle.loadSystemState(system);
                const servers = systemState.servers();

                const responses = await Promise.allSettled(
                    servers.map((server) =>
                        APIMethods.getQueryReferences(
                            server,
                            reference,
                            cursor,
                            requestEvents,
                            countLwwElementReferences,
                            countReferences,
                            extraByteReferences,
                        ),
                    ),
                );
                const fulfilledResponses = responses
                    .filter((response) => response.status === 'fulfilled')
                    .map(
                        (response) =>
                            (
                                response as PromiseFulfilledResult<Protocol.QueryReferencesResponse>
                            ).value,
                    );

                if (cancelContext.cancelled() === false) {
                    setState(fulfilledResponses);
                }
            } catch (error) {
                console.error(error);
            }
        };

        fetchQueryReferences();

        return () => {
            cancelContext.cancel();
            setState(undefined);
        };
    }, [
        system,
        reference,
        cursor,
        requestEvents,
        countLwwElementReferences,
        countReferences,
        extraByteReferences,
        processHandle,
    ]);

    return state;
};

export const useQueryPointerReferences = (
    pointer: Models.Pointer.Pointer,
    cursor?: Uint8Array,
    requestEvents?: Protocol.QueryReferencesRequestEvents,
    countLwwElementReferences?: Protocol.QueryReferencesRequestCountLWWElementReferences[],
    countReferences?: Protocol.QueryReferencesRequestCountReferences[],
) => {
    const { system } = pointer;
    const reference = useMemo(
        () => Models.pointerToReference(pointer),
        [pointer],
    );

    return useQueryReferences(
        system,
        reference,
        cursor,
        requestEvents,
        countLwwElementReferences,
        countReferences,
    );
};

// Declare explicitly so they don't cause a useEffect rerender
const postStatsRequestEvents = {
    fromType: Models.ContentType.ContentTypePost,
    countLwwElementReferences: [],
    countReferences: [],
};

const postStatLwwElementReferences = [
    {
        fromType: Models.ContentType.ContentTypeOpinion,
        value: Models.Opinion.OpinionLike,
    },
    {
        fromType: Models.ContentType.ContentTypeOpinion,
        value: Models.Opinion.OpinionDislike,
    },
];

const postStatReferences = [
    {
        fromType: Models.ContentType.ContentTypePost,
    },
];

export const usePostStats = (pointer: Models.Pointer.Pointer) => {
    const out = useQueryPointerReferences(
        pointer,
        undefined,
        postStatsRequestEvents,
        postStatLwwElementReferences,
        postStatReferences,
    );

    const counts = useMemo(() => {
        if (out === undefined)
            return {
                likes: undefined,
                dislikes: undefined,
                comments: undefined,
            };

        let likes = 0;
        let dislikes = 0;
        let comments = 0;

        out?.forEach((response) => {
            likes += response.counts[0].toNumber();
            dislikes += response.counts[1].toNumber();
            comments += response.counts[2].toNumber();
        });

        return {
            likes,
            dislikes,
            comments,
        };
    }, [out]);

    return counts;
};

export const useQueryIfAdded = (
    contentType: Models.ContentType.ContentType,
    system?: Models.PublicKey.PublicKey,
    value?: Uint8Array,
) => {
    const { processHandle } = useProcessHandleManager();
    const [state, setState] = useState<boolean | undefined>(undefined);

    useEffect(() => {
        if (system === undefined || value === undefined) {
            return;
        }

        const cancelContext = new CancelContext.CancelContext();
        processHandle
            .store()
            .indexCRDTElementSet.queryIfAdded(system, contentType, value)
            .then((result) => {
                if (cancelContext.cancelled()) {
                    return;
                }
                setState(result);
            });

        return () => {
            cancelContext.cancel();
            setState(undefined);
        };
    }, [processHandle, system, contentType, value]);

    return state;
};

export const useQueryOpinion = (
    system?: Models.PublicKey.PublicKey,
    subject?: Protocol.Reference,
) => {
    const { processHandle } = useProcessHandleManager();
    const [opinion, setOpinion] = useState<Models.Opinion.Opinion | undefined>(
        undefined,
    );

    useEffect(() => {
        if (system === undefined || subject === undefined) {
            setOpinion(undefined);
            return;
        }

        const cancelContext = new CancelContext.CancelContext();
        processHandle
            .store()
            .indexOpinion.get(system, subject)
            .then((result) => {
                if (cancelContext.cancelled()) {
                    return;
                }
                setOpinion(result);
            });

        return () => {
            cancelContext.cancel();
        };
    }, [processHandle, system, subject]);

    return opinion;
};

export function useQueryCursor<T>(
    loadCallback: Queries.QueryCursor.LoadCallback,
    parse: (buffer: Uint8Array) => T,
    batchSize = 30,
): [Array<ParsedEvent<T>>, () => void, boolean] {
    const { processHandle } = useProcessHandleManager();
    const [nothingFound, setNothingFound] = useState<boolean>(false);
    const [state, setState] = useState<Array<ParsedEvent<T>>>([]);
    const query = useRef<Queries.QueryCursor.Query | null>(null);
    const [advance, setAdvance] = useState<() => void>(() => {
        return () => {};
    });

    useEffect(() => {
        setState([]);
        setAdvance(() => () => {});

        const cancelContext = new CancelContext.CancelContext();

        const addNewCells = (
            newCells: ReadonlyArray<Queries.QueryCursor.Cell>,
        ) => {
            if (cancelContext.cancelled()) {
                return;
            }

            const newCellsAsSignedEvents = newCells.map((cell) => {
                const { signedEvent } = cell;
                const event = Models.Event.fromBuffer(signedEvent.event);
                const parsed = parse(event.content);

                const eventsReferencing = event.references.filter((reference) =>
                    reference.referenceType.eq(2),
                );
                eventsReferencing.forEach((eventReference) => {
                    const pointer = Models.Pointer.fromProto(
                        Protocol.Pointer.decode(eventReference.reference),
                    );
                    // TODO: This is a hack to make sure we have the address hint for the pointer.
                    // We should be returning related events from the query and using those instead.
                    processHandle.addAddressHint(
                        pointer.system,
                        cell.fromServer,
                    );
                });
                processHandle.addAddressHint(event.system, cell.fromServer);

                return new ParsedEvent<T>(signedEvent, event, parsed);
            });
            setState((currentCells) =>
                [...currentCells].concat(newCellsAsSignedEvents),
            );
        };

        const nothingFoundCallback = () => {
            setNothingFound(true);
        }

        const newQuery = new Queries.QueryCursor.Query(
            processHandle,
            loadCallback,
            addNewCells,
            batchSize,
            nothingFoundCallback
        );
        query.current = newQuery;
        setAdvance(
            () =>
                (() => {
                    query.current?.advance();
                }) ?? (() => {}),
        );
        return () => {
            cancelContext.cancel();
            newQuery.cleanup();
        };
        // NOTE: Currently we don't care about dynamic batch sizes.
        // If we do, the current implementation of this hook will result in clearing the whole feed when the batch size changes.
    }, [processHandle, loadCallback, batchSize, parse]);

    return [state, advance, nothingFound];
}

export function useQueryEvent<T>(
    system: Models.PublicKey.PublicKey,
    process: Models.Process.Process,
    logicalClock: Long,
    parse: (buffer: Uint8Array) => T,
): ParsedEvent<T> | undefined {
    const queryManager = useQueryManager();

    const [parsedEvent, setParsedEvent] = useState<ParsedEvent<T> | undefined>(
        undefined,
    );

    useEffect(() => {
        if (system !== undefined) {
            const cancelContext = new CancelContext.CancelContext();

            const unregister = queryManager.queryEvent.query(
                system,
                process,
                logicalClock,
                (signedEvent: Models.SignedEvent.SignedEvent | undefined) => {
                    if (cancelContext.cancelled()) {
                        return;
                    }

                    let parsedEvent: ParsedEvent<T> | undefined = undefined;

                    if (signedEvent !== undefined) {
                        const event = Models.Event.fromBuffer(
                            signedEvent.event,
                        );
                        const parsed = parse(event.content);

                        parsedEvent = new ParsedEvent<T>(
                            signedEvent,
                            event,
                            parsed,
                        );
                    }

                    setParsedEvent(parsedEvent);
                },
            );

            return () => {
                cancelContext.cancel();
                unregister();
                setParsedEvent(undefined);
            };
        }
    }, [queryManager, system, process, logicalClock, parse]);

    return parsedEvent;
}

export function useQueryPost(
    system: Models.PublicKey.PublicKey,
    process: Models.Process.Process,
    logicalClock: Long,
): ParsedEvent<Protocol.Post> | undefined {
    return useQueryEvent(system, process, logicalClock, Protocol.Post.decode);
}

export const useQueryReferenceEventFeed = <T>(
    decode: (buffer: Uint8Array) => T,
    reference?: Protocol.Reference,
    requestEvents?: Protocol.QueryReferencesRequestEvents,
    countLwwElementReferences?: Protocol.QueryReferencesRequestCountLWWElementReferences[],
    countReferences?: Protocol.QueryReferencesRequestCountReferences[],
    extraByteReferences?: Uint8Array[],
) => {
    const loadCallback: Queries.QueryCursor.LoadCallback = useMemo(() => {
        return async (server, limit, cursor) => {
            if (reference === undefined) {
                return Models.ResultEventsAndRelatedEventsAndCursor.fromEmpty();
            }

            // limit is hardcoded to 20 serverside right now, which is fine for now.
            const response = await APIMethods.getQueryReferences(
                server,
                reference,
                cursor,
                requestEvents,
                countLwwElementReferences,
                countReferences,
                extraByteReferences,
            );

            return Models.ResultEventsAndRelatedEventsAndCursor.fromQueryReferencesResponse(
                response,
            );
        };
    }, [
        countLwwElementReferences,
        countReferences,
        reference,
        requestEvents,
        extraByteReferences,
    ]);

    return useQueryCursor(loadCallback, decode);
};

export function useQueryCRDTSet(
    system: Models.PublicKey.PublicKey | undefined,
    contentType: Models.ContentType.ContentType,
    batchSize = 100,
): [Array<Models.Event.Event>, () => void] {
    const queryManager = useQueryManager();
    const [state, setState] = useState<Array<Queries.QueryIndex.Cell>>([]);
    const [advance, setAdvance] = useState<() => void>(() => () => {});

    useEffect(() => {
        if (system !== undefined) {
            const cancelContext = new CancelContext.CancelContext();

            const { advance, unregister } = queryManager.queryCRDTSet.query(
                system,
                contentType,
                (patch) => {
                    if (cancelContext.cancelled()) {
                        return;
                    }

                    setState((state) => {
                        const out = Queries.QueryIndex.applyPatch(state, patch);
                        return out;
                    });
                },
            );

            setAdvance(() => () => advance(batchSize));

            return () => {
                cancelContext.cancel();
                unregister();
                setState([]);
                setAdvance(() => () => {});
            };
        }
    }, [queryManager, system, contentType, batchSize]);

    const events = useMemo(() => {
        return state
            .filter((cell) => cell.signedEvent !== undefined)
            .map((cell) => {
                // @ts-ignore
                const event = Models.Event.fromBuffer(cell.signedEvent.event);
                return event;
            });
    }, [state]);

    return [events, advance];
}
