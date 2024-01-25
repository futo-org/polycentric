import Long from 'long';
import * as RXJS from 'rxjs';

import * as APIMethods from '../api-methods';
import * as ProcessHandle from '../process-handle';
import * as Models from '../models';
import * as Shared from './shared';
import * as Util from '../util';
import { HasUpdate } from './has-update';

type CallbackValue = ReadonlyMap<
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
};

export class QueryHead extends HasUpdate {
    private readonly processHandle: ProcessHandle.ProcessHandle;
    private readonly state: Map<
        Models.PublicKey.PublicKeyString,
        StateForSystem
    >;

    constructor(processHandle: ProcessHandle.ProcessHandle) {
        super();

        this.processHandle = processHandle;
        this.state = new Map();
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
                };
            },
        );

        stateForSystem.queries.add(callback);

        if (stateForSystem.fulfilled === true) {
            callback(stateForSystem.head);
        } else if (!stateForSystem.loadAttempted) {
            stateForSystem.loadAttempted = true;

            this.loadFromNetwork(system);
        }

        return () => {
            stateForSystem.queries.delete(callback);

            if (stateForSystem.queries.size === 0) {
                this.state.delete(systemString);
            }
        };
    }

    private async loadFromNetwork(
        system: Models.PublicKey.PublicKey,
    ): Promise<void> {
        const systemState = await this.processHandle.loadSystemState(system);

        for (const server of systemState.servers()) {
            try {
                const events = await APIMethods.getHead(server, system);
                events.events.forEach((x) => this.update(x));
            } catch (err) {
                console.log(err);
            }
        }
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
