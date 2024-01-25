import Long from 'long';
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

type StateForSystem = {
    readonly head: Map<
        Models.Process.ProcessString,
        Models.SignedEvent.SignedEvent
    >;
    readonly queries: Set<Callback>;
    fulfilled: boolean;
    loadAttempted: boolean;
    cancelContext: CancelContext;
};

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
            () => {
                return {
                    head: new Map(),
                    queries: new Set(),
                    fulfilled: false,
                    loadAttempted: false,
                    cancelContext: new CancelContext(),
                };
            },
        );

        if (stateForSystem.queries.has(callback)) {
            throw Shared.DuplicatedCallbackError;
        }

        stateForSystem.queries.add(callback);

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
            stateForSystem.queries.delete(callback);

            if (stateForSystem.queries.size === 0) {
                stateForSystem.cancelContext.cancel();

                this.state.delete(systemString);
            }
        };
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

        signedEvents.map((signedEvent) => this.update(signedEvent));
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

                events.events.forEach((x) => this.update(x));
            } catch (err) {
                console.log(err);
            }
        };

        await Promise.all(systemState.servers().map(loadFromServer));
    }

    public update(signedEvent: Models.SignedEvent.SignedEvent): void {
        const event = Models.Event.fromBuffer(signedEvent.event);

        const systemString = Models.PublicKey.toString(event.system);

        const stateForSystem = this.state.get(systemString);

        if (stateForSystem === undefined) {
            return;
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

            for (const callback of stateForSystem.queries) {
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
