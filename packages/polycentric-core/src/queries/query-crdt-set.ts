import * as RXJS from 'rxjs';

import * as Base64 from '@borderless/base64';

import * as Models from '../models';
import * as Protocol from '../protocol';
import * as QueryIndex from './query-index';

interface StateForItem {
    readonly cell: QueryIndex.Cell;
    readonly lwwElement: Protocol.LWWElementSet;
}

interface StateForQuery {
    readonly queryIndexCallback: QueryIndex.Callback;
    readonly items: Map<string, StateForItem>;
}

export interface QueryHandle {
    advance(additionalCount: number): void;
    unregister(): void;
}

export class QueryManager {
    private readonly _queryIndex: QueryIndex.QueryManager;
    private readonly _state: Map<QueryIndex.Callback, StateForQuery>;

    constructor(queryIndex: QueryIndex.QueryManager) {
        this._queryIndex = queryIndex;
        this._state = new Map();
    }

    public query(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
        callback: QueryIndex.Callback,
    ): QueryHandle {
        if (this._state.get(callback)) {
            throw new Error('duplicated callback QueryCRDTSet');
        }

        const items = new Map<string, StateForItem>();

        const queryIndexCallback = (params: QueryIndex.CallbackParameters) => {
            const toAdd: QueryIndex.Cell[] = [];
            const toRemove = new Set<string>();

            for (const cell of params.add) {
                if (cell.signedEvent === undefined) {
                    toAdd.push(cell);

                    continue;
                }

                const event = Models.Event.fromBuffer(cell.signedEvent.event);

                if (event.lwwElementSet === undefined) {
                    throw new Error('expected lwwElement');
                }

                const key = Base64.encode(event.lwwElementSet.value);

                const existing = items.get(key);

                if (
                    existing === undefined ||
                    existing.lwwElement.unixMilliseconds.lessThan(
                        event.lwwElementSet.unixMilliseconds,
                    )
                ) {
                    items.set(key, {
                        cell: cell,
                        lwwElement: event.lwwElementSet,
                    });

                    if (
                        event.lwwElementSet.operation ===
                        Protocol.LWWElementSet_Operation.ADD
                    ) {
                        toAdd.push(cell);
                    }

                    if (existing) {
                        toRemove.add(existing.cell.key);
                    }
                }
            }

            for (const key of params.remove) {
                toRemove.add(key);
            }

            if (toAdd.length > 0 || toRemove.size > 0) {
                callback({
                    add: toAdd,
                    remove: toRemove,
                });
            }
        };

        const stateForQuery = {
            queryIndexCallback: queryIndexCallback,
            items: items,
        };

        this._state.set(callback, stateForQuery);

        const queryIndexHandle = this._queryIndex.query(
            system,
            contentType,
            queryIndexCallback,
        );

        let unregistered = false;

        return {
            advance: (additionalCount: number) => {
                if (!unregistered) {
                    queryIndexHandle.advance(additionalCount);
                }
            },
            unregister: () => {
                unregistered = true;

                queryIndexHandle.unregister();

                this._state.delete(callback);
            },
        };
    }
}

export function queryCRDTSetCompleteObservable<T>(
    queryManager: QueryManager,
    system: Models.PublicKey.PublicKey,
    contentType: Models.ContentType.ContentType,
    parse: (value: Uint8Array) => T,
): RXJS.Observable<ReadonlySet<T>> {
    const processQueryState = (queryState: QueryIndex.Cell[]) => {
        const result = new Set<T>();

        for (const cell of queryState) {
            if (cell.signedEvent === undefined) {
                continue;
            }

            const event = Models.Event.fromBuffer(cell.signedEvent.event);

            if (event.contentType.notEquals(contentType)) {
                throw new Error('impossible');
            }

            if (event.lwwElementSet === undefined) {
                throw new Error('impossible');
            }

            result.add(parse(event.lwwElementSet.value));
        }

        return result;
    };

    return new RXJS.Observable((subscriber) => {
        let queryState: QueryIndex.Cell[] = [];

        const handle = queryManager.query(system, contentType, (patch) => {
            queryState = QueryIndex.applyPatch(queryState, patch);

            subscriber.next(processQueryState(queryState));

            handle.advance(10);
        });

        handle.advance(10);

        return handle.unregister.bind(handle);
    });
}
