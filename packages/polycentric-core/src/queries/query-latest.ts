import * as RXJS from 'rxjs';

import * as APIMethods from '../api-methods';
import * as Models from '../models';
import { UnregisterCallback, DuplicatedCallbackError } from './shared';
import * as Util from '../util';
import { ProcessHandle } from '../process-handle';
import * as QueryHead from './query-head2';

export type Callback = (
    values: ReadonlyMap<
        Models.Process.ProcessString,
        Models.SignedEvent.SignedEvent
    >,
) => void;

type StateForContentType = {
    fulfilled: boolean;
    readonly values: Map<
        Models.Process.ProcessString,
        Models.SignedEvent.SignedEvent
    >;
    readonly callbacks: Set<Callback>;
    readonly unsubscribe: () => void;
};

type StateForSystem = {
    readonly stateForContentType: Map<
        Models.ContentType.ContentTypeString,
        StateForContentType
    >;
};

export class QueryLatest {
    private readonly state: Map<
        Models.PublicKey.PublicKeyString,
        StateForSystem
    >;
    private readonly queryHead: QueryHead.QueryHead;
    private readonly processHandle: ProcessHandle;
    private useDisk: boolean;
    private useNetwork: boolean;

    constructor(processHandle: ProcessHandle, queryHead: QueryHead.QueryHead) {
        this.state = new Map();
        this.queryHead = queryHead;
        this.processHandle = processHandle;
        this.useDisk = true;
        this.useNetwork = true;
    }

    public shouldUseDisk(useDisk: boolean): void {
        this.useDisk = useDisk;
    }

    public shouldUseNetwork(useNetwork: boolean): void {
        this.useNetwork = useNetwork;
    }

    public query(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
        callback: Callback,
    ): UnregisterCallback {
        const systemString = Models.PublicKey.toString(system);

        const stateForSystem: StateForSystem = Util.lookupWithInitial(
            this.state,
            systemString,
            () => {
                return {
                    stateForContentType: new Map(),
                };
            },
        );

        const contentTypeString = Models.ContentType.toString(contentType);

        let initial = false;

        const stateForContentType: StateForContentType = Util.lookupWithInitial(
            stateForSystem.stateForContentType,
            contentTypeString,
            () => {
                initial = true;

                const toMerge = [];

                if (this.useDisk) {
                    toMerge.push(this.loadFromDisk(system, contentType));
                }

                if (this.useNetwork) {
                    toMerge.push(this.loadFromNetwork(system, contentType));
                }

                const subscription = RXJS.merge(...toMerge).subscribe(
                    this.updateBatch.bind(this),
                );

                return {
                    fulfilled: false,
                    values: new Map(),
                    callbacks: new Set([callback]),
                    unsubscribe: subscription.unsubscribe.bind(subscription),
                };
            },
        );

        if (!initial) {
            if (stateForContentType.callbacks.has(callback)) {
                throw DuplicatedCallbackError;
            }

            stateForContentType.callbacks.add(callback);

            if (stateForContentType.fulfilled) {
                callback(stateForContentType.values);
            }
        }

        return () => {
            stateForContentType.callbacks.delete(callback);

            if (stateForContentType.callbacks.size === 0) {
                stateForSystem.stateForContentType.delete(contentTypeString);

                if (stateForSystem.stateForContentType.size === 0) {
                    this.state.delete(systemString);
                }
            }
        };
    }

    private loadFromDisk(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
    ): RXJS.Observable<Array<Models.SignedEvent.SignedEvent>> {
        const loadFromDisk = async (
            signedEvent: Models.SignedEvent.SignedEvent,
        ) =>
            await this.processHandle
                .store()
                .indexSystemProcessContentTypeLogicalClock.getLatest(
                    system,
                    Models.Event.fromBuffer(signedEvent.event).process,
                    contentType,
                );

        return QueryHead.queryHeadObservable(this.queryHead, system).pipe(
            RXJS.switchMap((head) =>
                RXJS.combineLatest(
                    Util.mapToArray(head, (signedEvent) =>
                        RXJS.from(loadFromDisk(signedEvent)),
                    ),
                ),
            ),
            RXJS.switchMap((signedEvents) =>
                RXJS.of(
                    signedEvents.filter(
                        (
                            signedEvent,
                        ): signedEvent is Models.SignedEvent.SignedEvent =>
                            !!signedEvent,
                    ),
                ),
            ),
        );
    }

    private loadFromNetwork(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
    ): RXJS.Observable<Array<Models.SignedEvent.SignedEvent>> {
        const loadServerList = async () =>
            (await this.processHandle.loadSystemState(system)).servers();

        const loadFromServer = async (server: string) =>
            (await APIMethods.getQueryLatest(server, system, [contentType]))
                .events;

        return RXJS.from(loadServerList()).pipe(
            RXJS.switchMap((servers) =>
                servers.map((server) => RXJS.from(loadFromServer(server))),
            ),
            RXJS.mergeAll(),
        );
    }

    public updateBatch(
        signedEvents: Array<Models.SignedEvent.SignedEvent>,
    ): void {}
}
