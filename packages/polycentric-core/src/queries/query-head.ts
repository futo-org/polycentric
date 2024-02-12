import * as RXJS from 'rxjs';

import * as APIMethods from '../api-methods';
import * as ProcessHandle from '../process-handle';
import * as Models from '../models';
import * as Shared from './shared';
import * as Util from '../util';
import * as Protocol from '../protocol';
import { HasUpdate } from './has-update';
import { CancelContext } from '../cancel-context';
import { OnceFlag } from '../util';
import { QueryServers, queryServersObservable } from './query-servers';

export type CallbackValue = {
    readonly missingData: boolean;
    readonly head: ReadonlyMap<
        Models.Process.ProcessString,
        Models.SignedEvent.SignedEvent
    >;
    readonly processLists: ReadonlyMap<
        Models.Process.ProcessString,
        Models.SignedEvent.SignedEvent
    >;
    readonly attemptedSources: ReadonlySet<string>;
};

type CallbackValueInternal = {
    missingData: boolean;
    readonly head: Map<
        Models.Process.ProcessString,
        Models.SignedEvent.SignedEvent
    >;
    readonly processLists: Map<
        Models.Process.ProcessString,
        Models.SignedEvent.SignedEvent
    >;
    readonly attemptedSources: Set<string>;
};

type Callback = (value: CallbackValue) => void;

class StateForSystem {
    value: CallbackValueInternal;
    readonly callbacks: Set<Callback>;
    readonly contextHolds: Set<CancelContext>;
    readonly fulfilled: OnceFlag;
    unsubscribe: (() => void) | undefined;

    constructor() {
        this.value = {
            missingData: false,
            head: new Map(),
            processLists: new Map(),
            attemptedSources: new Set(),
        };
        this.callbacks = new Set();
        this.contextHolds = new Set();
        this.fulfilled = new OnceFlag();
        this.unsubscribe = undefined;
    }
}

type Batch = {
    readonly source: string;
    readonly signedEvents: ReadonlyArray<Models.SignedEvent.SignedEvent>;
};

export class QueryHead extends HasUpdate {
    private readonly processHandle: ProcessHandle.ProcessHandle;
    private readonly queryServers: QueryServers;
    private readonly state: Map<
        Models.PublicKey.PublicKeyString,
        StateForSystem
    >;
    private useDisk: boolean;
    private useNetwork: boolean;

    constructor(
        processHandle: ProcessHandle.ProcessHandle,
        queryServers: QueryServers,
    ) {
        super();

        this.processHandle = processHandle;
        this.queryServers = queryServers;
        this.state = new Map();
        this.useDisk = true;
        this.useNetwork = true;
    }

    public get clean(): boolean {
        return this.state.size === 0;
    }

    public shouldUseDisk(useDisk: boolean): void {
        this.useDisk = useDisk;
    }

    public shouldUseNetwork(useNetwork: boolean): void {
        this.useNetwork = useNetwork;
    }

    public query(
        system: Models.PublicKey.PublicKey,
        callback: Callback,
    ): Shared.UnregisterCallback {
        const systemString = Models.PublicKey.toString(system);

        let initial = false;

        const stateForSystem: StateForSystem = Util.lookupWithInitial(
            this.state,
            systemString,
            () => {
                initial = true;

                return new StateForSystem();
            },
        );

        if (stateForSystem.callbacks.has(callback)) {
            throw Shared.DuplicatedCallbackError;
        }

        stateForSystem.callbacks.add(callback);

        if (stateForSystem.fulfilled.value) {
            callback(stateForSystem.value);
        }

        if (initial) {
            const toMerge = [];

            if (this.useDisk) {
                toMerge.push(this.loadFromDisk(system));
            }

            if (this.useNetwork) {
                toMerge.push(this.loadFromNetwork(system));
            }

            const subscription = RXJS.merge(...toMerge).subscribe((batch) =>
                batch.signedEvents.length > 0
                    ? this.updateBatch(
                          undefined,
                          batch.signedEvents,
                          batch.source,
                      )
                    : this.updateEmptyBatch(stateForSystem, batch.source),
            );

            stateForSystem.unsubscribe =
                subscription.unsubscribe.bind(subscription);
        }

        return () => {
            stateForSystem.callbacks.delete(callback);

            this.cleanup(systemString, stateForSystem);
        };
    }

    private cleanup(
        systemString: Models.PublicKey.PublicKeyString,
        stateForSystem: StateForSystem,
    ): void {
        if (
            stateForSystem.callbacks.size === 0 &&
            stateForSystem.contextHolds.size === 0
        ) {
            stateForSystem.unsubscribe?.();

            this.state.delete(systemString);
        }
    }

    private loadFromDisk(
        system: Models.PublicKey.PublicKey,
    ): RXJS.Observable<Batch> {
        const loadProcessHead = (processProto: Protocol.Process) => {
            const process = Models.Process.fromProto(processProto);

            return RXJS.from(
                this.processHandle
                    .store()
                    .indexProcessStates.getProcessState(system, process),
            ).pipe(
                RXJS.switchMap((processState) =>
                    RXJS.from(
                        this.processHandle
                            .store()
                            .indexEvents.getSignedEvent(
                                system,
                                process,
                                processState.logicalClock,
                            ),
                    ).pipe(
                        RXJS.switchMap((potentialEvent) =>
                            potentialEvent
                                ? RXJS.of(potentialEvent)
                                : RXJS.NEVER,
                        ),
                    ),
                ),
            );
        };

        return RXJS.from(
            this.processHandle.store().indexSystemStates.getSystemState(system),
        ).pipe(
            RXJS.switchMap((systemState) =>
                systemState.processes.length > 0
                    ? RXJS.combineLatest(
                          systemState.processes.map(loadProcessHead),
                      )
                    : RXJS.of([]),
            ),
            RXJS.switchMap((signedEvents) =>
                RXJS.of({
                    source: 'disk',
                    signedEvents: signedEvents,
                }),
            ),
        );
    }

    private loadFromNetwork(
        system: Models.PublicKey.PublicKey,
    ): RXJS.Observable<Batch> {
        const loadFromServer = async (server: string) => {
            return {
                source: server,
                signedEvents: (await APIMethods.getHead(server, system)).events,
            };
        };

        return queryServersObservable(this.queryServers, system).pipe(
            RXJS.switchMap((servers: ReadonlySet<string>) =>
                RXJS.of(...Array.from(servers)),
            ),
            RXJS.distinct(),
            RXJS.mergeMap((server: string) =>
                RXJS.from(loadFromServer(server)).pipe(
                    RXJS.catchError(() => RXJS.NEVER),
                ),
            ),
        );
    }

    public update(signedEvent: Models.SignedEvent.SignedEvent): void {
        this.updateBatch(undefined, [signedEvent], 'unknown');
    }

    public updateWithContextHold(
        signedEvent: Models.SignedEvent.SignedEvent,
        contextHold: CancelContext | undefined,
    ): void {
        this.updateBatch(contextHold, [signedEvent], 'unknown');
    }

    private updateEmptyBatch(
        stateForSystem: StateForSystem,
        source: string,
    ): void {
        stateForSystem.fulfilled.set();
        stateForSystem.value.attemptedSources.add(source);

        for (const callback of stateForSystem.callbacks) {
            callback(stateForSystem.value);
        }
    }

    private isStateMissingData(stateForSystem: StateForSystem): boolean {
        const value = stateForSystem.value;

        for (const [processString, headSignedEvent] of value.head.entries()) {
            const headEvent = Models.Event.fromBuffer(headSignedEvent.event);

            const systemProcessesIndex = Models.Event.lookupIndex(
                headEvent,
                Models.ContentType.ContentTypeSystemProcesses,
            );

            if (systemProcessesIndex === undefined) {
                continue;
            }

            const systemProcessesSignedEvent =
                value.processLists.get(processString);

            if (systemProcessesSignedEvent === undefined) {
                return true;
            }

            const systemProcessesEvent = Models.Event.fromBuffer(
                systemProcessesSignedEvent.event,
            );

            const systemProcesses = Models.SystemProcesses.fromBuffer(
                systemProcessesEvent.content,
            );

            if (
                headEvent.vectorClock.logicalClocks.length !==
                systemProcesses.processes.length
            ) {
                console.error('feed integrity violated');

                return true;
            }

            for (let i = 0; i < systemProcesses.processes.length; i++) {
                const otherHeadSignedEvent = value.head.get(
                    Models.Process.toString(systemProcesses.processes[i]),
                );

                if (otherHeadSignedEvent === undefined) {
                    return true;
                }

                if (otherHeadSignedEvent === headSignedEvent) {
                    continue;
                }

                const otherHeadEvent = Models.Event.fromBuffer(
                    otherHeadSignedEvent.event,
                );

                if (
                    otherHeadEvent.logicalClock.lessThan(
                        headEvent.vectorClock.logicalClocks[i],
                    )
                ) {
                    return true;
                }
            }
        }

        return false;
    }

    public updateBatch(
        contextHold: CancelContext | undefined,
        signedEvents: ReadonlyArray<Models.SignedEvent.SignedEvent>,
        source: string,
    ): void {
        const updatedStates = new Set<StateForSystem>();

        for (const signedEvent of signedEvents) {
            const event = Models.Event.fromBuffer(signedEvent.event);

            const systemString = Models.PublicKey.toString(event.system);

            let potentialStateForSystem = this.state.get(systemString);

            if (!potentialStateForSystem && contextHold) {
                potentialStateForSystem = new StateForSystem();

                this.state.set(systemString, potentialStateForSystem);
            } else if (!potentialStateForSystem) {
                return;
            }

            const stateForSystem: StateForSystem = potentialStateForSystem;

            if (contextHold) {
                stateForSystem.contextHolds.add(contextHold);

                contextHold.addCallback(() => {
                    stateForSystem.contextHolds.delete(contextHold);

                    this.cleanup(systemString, stateForSystem);
                });
            }

            const processString = Models.Process.toString(event.process);

            const headForSystem = stateForSystem.value.head.get(processString);

            let clockForProcess = undefined;

            if (headForSystem) {
                clockForProcess = Models.Event.fromBuffer(
                    headForSystem.event,
                ).logicalClock;
            }

            if (
                clockForProcess === undefined ||
                event.logicalClock.greaterThan(clockForProcess)
            ) {
                stateForSystem.value.head.set(processString, signedEvent);
                stateForSystem.fulfilled.set();
                updatedStates.add(stateForSystem);
            }

            if (
                event.contentType.equals(
                    Models.ContentType.ContentTypeSystemProcesses,
                )
            ) {
                const headSignedEvent =
                    stateForSystem.value.head.get(processString);

                if (headSignedEvent === undefined) {
                    throw Error('impossible');
                }

                const headEvent = Models.Event.fromBuffer(
                    headSignedEvent.event,
                );

                const index = Models.Event.lookupIndex(
                    headEvent,
                    Models.ContentType.ContentTypeSystemProcesses,
                );

                if (
                    headEvent.contentType.equals(
                        Models.ContentType.ContentTypeSystemProcesses,
                    ) ||
                    (index && index.equals(event.logicalClock))
                ) {
                    stateForSystem.value.processLists.set(
                        processString,
                        signedEvent,
                    );
                    updatedStates.add(stateForSystem);
                }
            }
        }

        for (const stateForSystem of updatedStates) {
            stateForSystem.value.missingData =
                this.isStateMissingData(stateForSystem);

            stateForSystem.value.attemptedSources.add(source);

            for (const callback of stateForSystem.callbacks) {
                callback(stateForSystem.value);
            }
        }
    }
}

export function queryHeadObservable(
    queryManager: QueryHead,
    system: Models.PublicKey.PublicKey,
): RXJS.Observable<CallbackValue> {
    return new RXJS.Observable((subscriber) => {
        return queryManager.query(system, (head) => {
            subscriber.next(head);
        });
    });
}
