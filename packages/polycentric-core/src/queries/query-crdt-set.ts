import * as QueryIndex from './query-index';
import * as Shared from './shared';
import * as Models from '../models';
import * as Protocol from '../protocol';

type StateForQuery = {
    queryIndexCallback: QueryIndex.Callback;
    items: Map<string, Protocol.LWWElement>;
};

export class QueryManager {
    private _queryIndex: QueryIndex.QueryManager;
    private _state: Map<QueryIndex.Callback, StateForQuery>;

    constructor(queryIndex: QueryIndex.QueryManager) {
        this._queryIndex = queryIndex;
        this._state = new Map();
    }

    public query(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
        callback: QueryIndex.Callback,
    ): Shared.UnregisterCallback {
        if (this._state.get(callback)) {
            throw new Error('duplicated callback QueryCRDTSet');
        }

        const queryIndexCallback = (
            params: QueryIndex.CallbackParameters,
        ) => {};

        const stateForQuery = {
            queryIndexCallback: queryIndexCallback,
            items: new Map(),
        };

        this._state.set(callback, stateForQuery);

        const queryIndexUnregister = this._queryIndex.query(
            system,
            contentType,
            queryIndexCallback,
        );

        return () => {
            queryIndexUnregister();

            this._state.delete(callback);
        };
    }

    public advance(
        system: Models.PublicKey.PublicKey,
        callback: QueryIndex.Callback,
        additionalCount: number,
    ): void {
        const stateForQuery = this._state.get(callback);

        if (stateForQuery === undefined) {
            return;
        }

        this._queryIndex.advance(
            system,
            stateForQuery.queryIndexCallback,
            additionalCount,
        );
    }
}
