import * as ProcessHandle from '../process-handle';
import * as Models from '../models';

import * as QueryHead from './query-head';
import * as QueryIndex from './query-index';
import * as QueryEvent from './query-event';
import * as QueryCRDT from './query-crdt';
import * as QueryBlob from './query-blob';
import * as QueryCRDTSet from './query-crdt-set';
import { HasUpdate } from './has-update';

export class QueryManager extends HasUpdate {
    public readonly processHandle: ProcessHandle.ProcessHandle;

    public readonly queryHead: QueryHead.QueryManager;
    public readonly queryIndex: QueryIndex.QueryManager;
    public readonly queryEvent: QueryEvent.QueryManager;
    public readonly queryCRDT: QueryCRDT.QueryManager;
    public readonly queryBlob: QueryBlob.QueryManager;
    public readonly queryCRDTSet: QueryCRDTSet.QueryManager;

    private readonly stages: ReadonlyArray<HasUpdate>;

    public constructor(processHandle: ProcessHandle.ProcessHandle) {
        super();

        this.processHandle = processHandle;

        this.queryHead = new QueryHead.QueryManager(processHandle);
        this.queryIndex = new QueryIndex.QueryManager(processHandle);
        this.queryEvent = new QueryEvent.QueryManager(processHandle);
        this.queryCRDT = new QueryCRDT.QueryManager(processHandle);
        this.queryBlob = new QueryBlob.QueryManager(processHandle);
        this.queryCRDTSet = new QueryCRDTSet.QueryManager(this.queryIndex);

        this.stages = [
            this.queryHead,
            this.queryIndex,
            this.queryEvent,
            this.queryCRDT,
            this.queryBlob,
        ];
    }

    public update(signedEvent: Models.SignedEvent.SignedEvent): void {
        this.stages.forEach((stage) => stage.update(signedEvent));
    }
}
