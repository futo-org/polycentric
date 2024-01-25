import * as RXJS from 'rxjs';

import * as APIMethods from '../api-methods';
import * as ProcessHandle from '../process-handle';
import * as Models from '../models';
import * as Shared from './shared';
import * as Util from '../util';
import * as Protocol from '../protocol';
import { HasUpdate } from './has-update';
import { CancelContext } from '../cancel-context';

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
    fulfilled: boolean;
    loadAttempted: boolean;
    readonly cancelContext: CancelContext;

    constructor() {
        this.head = new Map();
        this.callbacks = new Set();
        this.contextHolds = new Set();
        this.fulfilled = false;
        this.loadAttempted = false;
        this.cancelContext = new CancelContext();
    }
}

export class QueryHead extends HasUpdate {
    private readonly processHandle: ProcessHandle.ProcessHandle;
    private readonly state: Map<
        Models.PublicKey.PublicKeyString,
        StateForSystem
    >;
    private useDisk: boolean;
    private useNetwork: boolean;

    constructor(processHandle: ProcessHandle.ProcessHandle) {
        super();

        this.processHandle = processHandle;
        this.state = new Map();
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
        callback: Callback,
    ): Shared.UnregisterCallback {
        const systemString = Models.PublicKey.toString(system);

        const stateForSystem: StateForSystem = Util.lookupWithInitial(
            this.state,
            systemString,
            () => new StateForSystem(),
        );

        if (stateForSystem.callbacks.has(callback)) {
            throw Shared.DuplicatedCallbackError;
        }

        stateForSystem.callbacks.add(callback);

        if (stateForSystem.fulfilled === true) {
            callback(stateForSystem.head);
        } else if (!stateForSystem.loadAttempted) {
            stateForSystem.loadAttempted = true;

            if (this.useNetwork) {
                this.loadFromNetwork(system, stateForSystem.cancelContext);
            }

            if (this.useDisk) {
                this.loadFromDisk(system, stateForSystem.cancelContext);
            }
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
            stateForSystem.cancelContext.cancel();

            this.state.delete(systemString);
        }
    }

    private async loadFromDisk(
        system: Models.PublicKey.PublicKey,
        cancelContext: CancelContext,
    ): Promise<void> {
        const systemState = await this.processHandle
            .store()
            .indexSystemStates.getSystemState(system);

        if (cancelContext.cancelled()) {
            return;
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
            return;
        }

        this.updateBatch(signedEvents, undefined);
    }

    private async loadFromNetwork(
        system: Models.PublicKey.PublicKey,
        cancelContext: CancelContext,
    ): Promise<void> {
        const systemState = await this.processHandle.loadSystemState(system);

        const loadFromServer = async (server: string) => {
            try {
                const events = await APIMethods.getHead(server, system);

                if (cancelContext.cancelled()) {
                    throw Shared.CancelledError;
                }

                this.updateBatch(events.events, undefined);
            } catch (err) {
                console.log(err);
            }
        };

        await Promise.all(systemState.servers().map(loadFromServer));
    }

    public update(signedEvent: Models.SignedEvent.SignedEvent): void {
        this.updateBatch([signedEvent], undefined);
    }

    public updateBatch(
        signedEvents: Array<Models.SignedEvent.SignedEvent>,
        contextHold: CancelContext | undefined,
    ): void {
        const updatedStates = new Set<StateForSystem>();

        for (const signedEvent of signedEvents) {
            const event = Models.Event.fromBuffer(signedEvent.event);

            const systemString = Models.PublicKey.toString(event.system);

            let potentialStateForSystem = this.state.get(systemString);

            if (!potentialStateForSystem && contextHold) {
                potentialStateForSystem = new StateForSystem();
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
                stateForSystem.fulfilled = true;
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
