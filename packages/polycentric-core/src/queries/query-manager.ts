import * as Models from '../models';
import * as ProcessHandle from '../process-handle';

import { QueryBlob } from './query-blob';
import { QueryCRDT } from './query-crdt';
import { QueryEvent } from './query-event';
import { QueryHead } from './query-head';
import { QueryLatest } from './query-latest';
import { QueryServers } from './query-servers';
import { QueryTopStringReferences } from './query-top-string-references';

import * as QueryCRDTSet from './query-crdt-set';
import * as QueryIndex from './query-index';
import { LoadedBatch } from './shared';

import { HasUpdate } from './has-update';

export class QueryManager extends HasUpdate {
    public skipLoadedBatchUpdate: boolean;

    public readonly processHandle: ProcessHandle.ProcessHandle;

    public readonly queryServers: QueryServers;
    public readonly queryHead: QueryHead;
    public readonly queryEvent: QueryEvent;
    public readonly queryBlob: QueryBlob;
    public readonly queryLatest: QueryLatest;
    public readonly queryCRDT: QueryCRDT;

    public readonly queryIndex: QueryIndex.QueryManager;
    public readonly queryCRDTSet: QueryCRDTSet.QueryManager;

    public readonly queryTopStringReferences: QueryTopStringReferences;

    private readonly stages: readonly HasUpdate[];

    public constructor(processHandle: ProcessHandle.ProcessHandle) {
        super();

        this.skipLoadedBatchUpdate = false;

        this.processHandle = processHandle;

        this.queryServers = new QueryServers(processHandle);
        this.queryHead = new QueryHead(
            processHandle,
            this.queryServers,
            this.loadedBatch.bind(this),
        );
        this.queryEvent = new QueryEvent(
            processHandle.store().indexEvents,
            this.queryServers,
            this.loadedBatch.bind(this),
        );
        this.queryBlob = new QueryBlob(this.queryEvent);
        this.queryLatest = new QueryLatest(
            processHandle.store().indexSystemProcessContentTypeLogicalClock,
            this.queryServers,
            this.queryHead,
            this.loadedBatch.bind(this),
        );
        this.queryCRDT = new QueryCRDT(this.queryHead, this.queryLatest);
        this.queryIndex = new QueryIndex.QueryManager(
            processHandle,
            this.loadedBatch.bind(this),
        );
        this.queryCRDTSet = new QueryCRDTSet.QueryManager(this.queryIndex);
        this.queryTopStringReferences = new QueryTopStringReferences(
            processHandle,
            this.queryServers,
        );

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

    private loadedBatch(loadedBatch: LoadedBatch): void {
        if (this.skipLoadedBatchUpdate) {
            return;
        }

        this.stages.forEach((stage) => {
            if (stage !== loadedBatch.origin) {
                loadedBatch.signedEvents.forEach((signedEvent) => {
                    stage.update(signedEvent);
                });
            }
        });

        if (loadedBatch.source !== 'disk') {
            loadedBatch.signedEvents.forEach((signedEvent) => {
                void this.processHandle.ingest(signedEvent, true);
            });
        }
    }
}
