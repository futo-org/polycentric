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

export type CallbackValue = ReadonlyMap<
    Models.Process.ProcessString,
    Models.SignedEvent.SignedEvent
>;

type Callback = (value: CallbackValue) => void;

class StateForSystem {
    readonly head: Map<
        Models.Process.ProcessString,
        Models.SignedEvent.SignedEvent
    >;
    readonly callbacks: Set<Callback>;
    readonly contextHolds: Set<CancelContext>;
    readonly fulfilled: OnceFlag;
    readonly loadAttempted: OnceFlag;
    unsubscribe: (() => void) | undefined;

    constructor() {
        this.head = new Map();
        this.callbacks = new Set();
        this.contextHolds = new Set();
        this.fulfilled = new OnceFlag();
        this.loadAttempted = new OnceFlag();
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

        const stateForSystem: StateForSystem = Util.lookupWithInitial(
            this.state,
            systemString,
            () => {
                return new StateForSystem();
            },
        );

        if (stateForSystem.callbacks.has(callback)) {
            throw Shared.DuplicatedCallbackError;
        }

        stateForSystem.callbacks.add(callback);

        if (stateForSystem.fulfilled.value) {
            callback(stateForSystem.head);
        } else if (!stateForSystem.loadAttempted.value) {
            stateForSystem.loadAttempted.set();

            const toMerge = [];

            if (this.useDisk) {
                toMerge.push(this.loadFromDiskObservable(system));
            }

            if (this.useNetwork) {
                toMerge.push(this.loadFromNetwork(system));
            }

            const subscription = RXJS.merge(...toMerge).subscribe(
                this.updateBatch.bind(this, undefined),
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

    private loadFromDiskObservable(
        system: Models.PublicKey.PublicKey,
    ): RXJS.Observable<Array<Models.SignedEvent.SignedEvent>> {
        return new RXJS.Observable((subscriber) => {
            const cancelContext = new CancelContext();

            (async () => {
                subscriber.next(await this.loadFromDisk(system, cancelContext));
            })();

            return () => {
                cancelContext.cancel();
            };
        });
    }

    private async loadFromDisk(
        system: Models.PublicKey.PublicKey,
        cancelContext: CancelContext,
    ): Promise<Array<Models.SignedEvent.SignedEvent>> {
        const systemState = await this.processHandle
            .store()
            .indexSystemStates.getSystemState(system);

        if (cancelContext.cancelled()) {
            return [];
        }

        const loadProcessHead = async (processProto: Protocol.Process) => {
            const process = Models.Process.fromProto(processProto);

            const processState = await this.processHandle
                .store()
                .indexProcessStates.getProcessState(system, process);

            if (cancelContext.cancelled()) {
                throw Shared.CancelledError;
            }

            const signedEvent = await this.processHandle
                .store()
                .indexEvents.getSignedEvent(
                    system,
                    process,
                    processState.logicalClock,
                );

            if (cancelContext.cancelled()) {
                throw Shared.CancelledError;
            }

            if (!signedEvent) {
                throw Shared.ImpossibleError;
            }

            return signedEvent;
        };

        const signedEvents = await Promise.all(
            systemState.processes.map(loadProcessHead),
        );

        if (cancelContext.cancelled()) {
            return [];
        }

        return signedEvents;
    }

    private loadFromNetwork(
        system: Models.PublicKey.PublicKey,
    ): RXJS.Observable<Array<Models.SignedEvent.SignedEvent>> {
        const loadFromServer = async (server: string) => {
            return (await APIMethods.getHead(server, system)).events;
        };

        return RXJS.from(
            queryServersObservable(this.queryServers, system),
        ).pipe(
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

            const headForSystem = stateForSystem.head.get(processString);

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
                stateForSystem.head.set(processString, signedEvent);
                stateForSystem.fulfilled.set();
                updatedStates.add(stateForSystem);
            }
        }

        for (const stateForSystem of updatedStates) {
            for (const callback of stateForSystem.callbacks) {
                callback(stateForSystem.head);
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
