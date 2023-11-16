import Long from 'long';

import * as APIMethods from '../api-methods';
import * as ProcessHandle from '../process-handle';
import * as Models from '../models';
import * as Shared from './shared';

type Callback = (value: Map<Models.Process.ProcessString, Long>) => void;

type StateForSystem = {
    head: Map<Models.Process.ProcessString, Long>;
    queries: Set<Callback>;
    fulfilled: boolean;
};

export class QueryManager {
    private _processHandle: ProcessHandle.ProcessHandle;
    private _state: Map<Models.PublicKey.PublicKeyString, StateForSystem>;

    constructor(processHandle: ProcessHandle.ProcessHandle) {
        this._processHandle = processHandle;
        this._state = new Map();
    }

    public query(
        system: Models.PublicKey.PublicKey,
        callback: Callback,
    ): Shared.UnregisterCallback {
        const systemString = Models.PublicKey.toString(system);

        let stateForSystem = this._state.get(systemString);

        if (stateForSystem === undefined) {
            stateForSystem = {
                head: new Map(),
                queries: new Set(),
                fulfilled: false,
            };

            this._state.set(systemString, stateForSystem);
        }

        stateForSystem.queries.add(callback);

        if (stateForSystem.fulfilled === true) {
            callback(stateForSystem.head);
        } else {
            this.loadFromNetwork(system);
        }

        return () => {
            if (stateForSystem !== undefined) {
                stateForSystem.queries.delete(callback);

                if (stateForSystem.queries.size === 0) {
                    this._state.delete(systemString);
                }
            } else {
                throw Error('impossible');
            }
        };
    }

    private async loadFromNetwork(
        system: Models.PublicKey.PublicKey,
    ): Promise<void> {
        const systemState = await this._processHandle.loadSystemState(system);

        for (const server of systemState.servers()) {
            try {
                const events = await APIMethods.getHead(server, system);
                events.events.forEach(this.update);
            } catch (err) {
                console.log(err);
            }
        }
    }

    public update(signedEvent: Models.SignedEvent.SignedEvent): void {
        const event = Models.Event.fromBuffer(signedEvent.event);

        const systemString = Models.PublicKey.toString(event.system);

        const stateForSystem = this._state.get(systemString);

        if (stateForSystem === undefined) {
            return;
        }

        const processString = Models.Process.toString(event.process);

        const clockForProcess = stateForSystem.head.get(processString);

        if (
            clockForProcess === undefined ||
            event.logicalClock.greaterThan(clockForProcess)
        ) {
            stateForSystem.head.set(processString, event.logicalClock);
            stateForSystem.fulfilled = true;

            for (const callback of stateForSystem.queries) {
                callback(stateForSystem.head);
            }
        }
    }
}
