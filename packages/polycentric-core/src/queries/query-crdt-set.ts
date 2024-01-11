import * as Base64 from '@borderless/base64';

import * as Models from '../models';
import * as Protocol from '../protocol';
import * as QueryIndex from './query-index';

type StateForItem = {
    readonly cell: QueryIndex.Cell;
    readonly lwwElement: Protocol.LWWElementSet;
};

type StateForQuery = {
    readonly queryIndexCallback: QueryIndex.Callback;
    readonly items: Map<string, StateForItem>;
};

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

        const items: Map<string, StateForItem> = new Map();

        const queryIndexCallback = (params: QueryIndex.CallbackParameters) => {
            const toAdd: Array<QueryIndex.Cell> = [];
            const toRemove: Set<string> = new Set();

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
                if (unregistered === false) {
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
