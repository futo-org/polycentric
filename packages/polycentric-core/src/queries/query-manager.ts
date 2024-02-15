import * as ProcessHandle from '../process-handle';
import * as Models from '../models';

import { QueryServers } from './query-servers';
import { QueryHead } from './query-head';
import { QueryEvent } from './query-event';
import { QueryBlob } from './query-blob';
import { QueryLatest } from './query-latest';
import { QueryCRDT } from './query-crdt';

import * as QueryIndex from './query-index';
import * as QueryCRDTSet from './query-crdt-set';

import { HasUpdate } from './has-update';

export class QueryManager extends HasUpdate {
    public readonly processHandle: ProcessHandle.ProcessHandle;

    public readonly queryServers: QueryServers;
    public readonly queryHead: QueryHead;
    public readonly queryEvent: QueryEvent;
    public readonly queryBlob: QueryBlob;
    public readonly queryLatest: QueryLatest;
    public readonly queryCRDT: QueryCRDT;

    public readonly queryIndex: QueryIndex.QueryManager;
    public readonly queryCRDTSet: QueryCRDTSet.QueryManager;

    private readonly stages: readonly HasUpdate[];

    public constructor(processHandle: ProcessHandle.ProcessHandle) {
        super();

        this.processHandle = processHandle;

        this.queryServers = new QueryServers(processHandle);
        this.queryHead = new QueryHead(processHandle, this.queryServers);
        this.queryEvent = new QueryEvent(
            processHandle.store().indexEvents,
            this.queryServers,
        );
        this.queryBlob = new QueryBlob(this.queryEvent);
        this.queryLatest = new QueryLatest(
            processHandle.store().indexSystemProcessContentTypeLogicalClock,
            this.queryServers,
            this.queryHead,
        );
        this.queryCRDT = new QueryCRDT(this.queryHead, this.queryLatest);

        this.queryIndex = new QueryIndex.QueryManager(processHandle);
        this.queryCRDTSet = new QueryCRDTSet.QueryManager(this.queryIndex);

        this.stages = [
            this.queryHead,
            this.queryEvent,
            this.queryLatest,
            this.queryIndex,
        ];
    }

    public update(signedEvent: Models.SignedEvent.SignedEvent): void {
        this.stages.forEach((stage) => {
            stage.update(signedEvent);
        });
    }
}
