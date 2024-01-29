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
};

type CallbackValueInternal = {
    missingData: boolean;
    readonly head: Map<
        Models.Process.ProcessString,
        Models.SignedEvent.SignedEvent
    >;
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
        };
        this.callbacks = new Set();
        this.contextHolds = new Set();
        this.fulfilled = new OnceFlag();
        this.unsubscribe = undefined;
    }
}

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
                batch.length > 0
                    ? this.updateBatch(undefined, batch)
                    : this.updateEmptyBatch(stateForSystem),
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
    ): RXJS.Observable<Array<Models.SignedEvent.SignedEvent>> {
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
        );
    }

    private loadFromNetwork(
        system: Models.PublicKey.PublicKey,
    ): RXJS.Observable<Array<Models.SignedEvent.SignedEvent>> {
        const loadFromServer = async (server: string) => {
            return (await APIMethods.getHead(server, system)).events;
        };

        return queryServersObservable(this.queryServers, system).pipe(
            RXJS.switchMap((servers) =>
                Array.from(servers).map((server) =>
                    RXJS.from(loadFromServer(server)),
                ),
            ),
            RXJS.mergeAll(),
        );
    }

    public update(signedEvent: Models.SignedEvent.SignedEvent): void {
        this.updateBatch(undefined, [signedEvent]);
    }

    public updateWithContextHold(
        signedEvent: Models.SignedEvent.SignedEvent,
        contextHold: CancelContext | undefined,
    ): void {
        this.updateBatch(contextHold, [signedEvent]);
    }

    private updateEmptyBatch(stateForSystem: StateForSystem): void {
        stateForSystem.fulfilled.set();

        for (const callback of stateForSystem.callbacks) {
            callback(stateForSystem.value);
        }
    }

    public updateBatch(
        contextHold: CancelContext | undefined,
        signedEvents: Array<Models.SignedEvent.SignedEvent>,
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
        }

        for (const stateForSystem of updatedStates) {
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
