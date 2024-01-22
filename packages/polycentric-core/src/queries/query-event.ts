import Long from 'long';
import * as Base64 from '@borderless/base64';

import * as APIMethods from '../api-methods';
import * as ProcessHandle from '../process-handle';
import * as Models from '../models';
import * as Shared from './shared';
import * as Util from '../util';

export type Callback = (
    signedEvent: Models.SignedEvent.SignedEvent | undefined,
) => void;

type StateForEvent = {
    signedEvent: Models.SignedEvent.SignedEvent | undefined;
    readonly callbacks: Set<Callback>;
    fulfilled: boolean;
};

function makeEventKey(
    system: Models.PublicKey.PublicKey,
    process: Models.Process.Process,
    logicalClock: Long,
): string {
    return (
        system.keyType.toString() +
        Base64.encode(system.key) +
        Base64.encode(process.process) +
        logicalClock.toString()
    );
}

export class QueryManager {
    private readonly _processHandle: ProcessHandle.ProcessHandle;
    private readonly _state: Map<string, StateForEvent>;
    private _useDisk: boolean;
    private _useNetwork: boolean;

    constructor(processHandle: ProcessHandle.ProcessHandle) {
        this._processHandle = processHandle;
        this._state = new Map();
        this._useDisk = true;
        this._useNetwork = true;
    }

    public useDisk(useDisk: boolean): void {
        this._useDisk = useDisk;
    }

    public useNetwork(useNetwork: boolean): void {
        this._useNetwork = useNetwork;
    }

    public query(
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
        logicalClock: Long,
        callback: Callback,
    ): Shared.UnregisterCallback {
        const key = makeEventKey(system, process, logicalClock);

        const state: StateForEvent = Util.lookupWithInitial(
            this._state,
            key,
            () => {
                return {
                    signedEvent: undefined,
                    callbacks: new Set(),
                    fulfilled: false,
                };
            },
        );

        state.callbacks.add(callback);

        if (state.fulfilled === true) {
            callback(state.signedEvent);
        } else {
            if (this._useDisk === true) {
                this.loadFromStore(system, process, logicalClock);
            }

            if (this._useNetwork === true) {
                this.loadFromNetwork(system, process, logicalClock);
            }
        }

        return () => {
            state.callbacks.delete(callback);

            if (state.callbacks.size === 0) {
                this._state.delete(key);
            }
        };
    }

    private async loadFromStore(
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
        logicalClock: Long,
    ): Promise<void> {
        const signedEvent = await this._processHandle
            .store()
            .indexEvents.getSignedEvent(system, process, logicalClock);

        if (signedEvent !== undefined) {
            this.update(signedEvent);
        }
    }

    private async loadFromNetwork(
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
        logicalClock: Long,
    ): Promise<void> {
        const systemState = await this._processHandle.loadSystemState(system);

        for (const server of systemState.servers()) {
            try {
                const events = await APIMethods.getEvents(server, system, {
                    rangesForProcesses: [
                        {
                            process: process,
                            ranges: [
                                {
                                    low: logicalClock,
                                    high: logicalClock,
                                },
                            ],
                        },
                    ],
                });

                events.events.forEach((x) => this.update(x));
            } catch (err) {
                console.log(err);
            }
        }
    }

    public update(signedEvent: Models.SignedEvent.SignedEvent): void {
        const event = Models.Event.fromBuffer(signedEvent.event);

        const key = (() => {
            if (
                event.contentType.equals(Models.ContentType.ContentTypeDelete)
            ) {
                const deleteModel = Models.Delete.fromBuffer(event.content);

                return makeEventKey(
                    event.system,
                    deleteModel.process,
                    deleteModel.logicalClock,
                );
            } else {
                return makeEventKey(
                    event.system,
                    event.process,
                    event.logicalClock,
                );
            }
        })();

        const state = this._state.get(key);

        if (state === undefined) {
            return;
        }

        state.fulfilled = true;

        if (event.contentType.equals(Models.ContentType.ContentTypeDelete)) {
            state.signedEvent = undefined;
        } else {
            state.signedEvent = signedEvent;
        }

        state.callbacks.forEach((callback) => {
            callback(state.signedEvent);
        });
    }
}
