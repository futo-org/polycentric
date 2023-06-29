import * as ProcessHandle from '../process-handle';
import * as Models from '../models';

import * as QueryHead from './query-head';
import * as QueryIndex from './query-index';
import * as QueryEvent from './query-event';
import * as QueryCRDT from './query-crdt';

export class QueryManager {
    private _processHandle: ProcessHandle.ProcessHandle;

    public queryHead: QueryHead.QueryManager;
    public queryIndex: QueryIndex.QueryManager;
    public queryEvent: QueryEvent.QueryManager;
    public queryCRDT: QueryCRDT.QueryManager;

    public constructor(processHandle: ProcessHandle.ProcessHandle) {
        this._processHandle = processHandle;

        this.queryHead = new QueryHead.QueryManager(processHandle);
        this.queryIndex = new QueryIndex.QueryManager(processHandle);
        this.queryEvent = new QueryEvent.QueryManager(processHandle);
        this.queryCRDT = new QueryCRDT.QueryManager(processHandle);

        processHandle.setListener((signedEvent) => {
            this.update(signedEvent);
        });
    }

    public update(signedEvent: Models.SignedEvent.SignedEvent): void {
        this.queryHead.update(signedEvent);
        this.queryIndex.update(signedEvent);
        this.queryEvent.update(signedEvent);
        this.queryCRDT.update(signedEvent);
    }
}
