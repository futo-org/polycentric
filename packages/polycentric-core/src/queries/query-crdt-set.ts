import * as QueryIndex from './query-index';

export class QueryManager {
    private _queryIndex: QueryIndex.QueryManager;

    constructor(queryIndex: QueryIndex.QueryManager) {
        this._queryIndex = queryIndex;
    }
}
