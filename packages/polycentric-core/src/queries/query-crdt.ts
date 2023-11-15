import Long from 'long';

import * as APIMethods from '../api-methods';
import * as ProcessHandle from '../process-handle';
import * as Models from '../models';
import * as Shared from './shared';

export type Callback = (value: Uint8Array) => void;

type StateForCRDT = {
    value: Uint8Array;
    unixMilliseconds: Long;
    callbacks: Set<Callback>;
    fulfilled: boolean;
};

type StateForSystem = {
    state: Map<string, StateForCRDT>;
};

function makeContentTypeKey(
    contentType: Models.ContentType.ContentType,
): string {
    return contentType.toString();
}

export class QueryManager {
    private _processHandle: ProcessHandle.ProcessHandle;
    private _state: Map<Models.PublicKey.PublicKeyString, StateForSystem>;
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
        contentType: Models.ContentType.ContentType,
        callback: Callback,
    ): Shared.UnregisterCallback {
        const systemString = Models.PublicKey.toString(system);

        let stateForSystem = this._state.get(systemString);

        if (stateForSystem === undefined) {
            stateForSystem = {
                state: new Map(),
            };

            this._state.set(systemString, stateForSystem);
        }

        const contentTypeString = makeContentTypeKey(contentType);

        let stateForCRDT = stateForSystem.state.get(contentTypeString);

        if (stateForCRDT === undefined) {
            stateForCRDT = {
                value: new Uint8Array(),
                unixMilliseconds: Long.UZERO,
                callbacks: new Set(),
                fulfilled: false,
            };

            stateForSystem.state.set(contentTypeString, stateForCRDT);
        }

        stateForCRDT.callbacks.add(callback);

        if (stateForCRDT.fulfilled === true) {
            callback(stateForCRDT.value);
        } else {
            if (this._useNetwork === true) {
                this.loadFromNetwork(system, contentType);
            }

            if (this._useDisk === true) {
                this.loadFromDisk(system);
            }
        }

        return () => {
            if (stateForCRDT !== undefined && stateForSystem !== undefined) {
                stateForCRDT.callbacks.delete(callback);

                let found = false;

                for (const query of stateForSystem.state.values()) {
                    if (query.callbacks.size !== 0) {
                        found = true;

                        break;
                    }
                }

                if (found === false) {
                    this._state.delete(systemString);
                }
            } else {
                throw Error('impossible');
            }
        };
    }

    private async loadFromDisk(
        system: Models.PublicKey.PublicKey,
    ): Promise<void> {
        const systemStateStore = await this._processHandle
            .store()
            .getSystemState(system);

        const stateForSystem = this._state.get(
            Models.PublicKey.toString(system),
        );

        if (stateForSystem === undefined) {
            return;
        }

        for (const item of systemStateStore.crdtItems) {
            const contentTypeKey = makeContentTypeKey(
                item.contentType as Models.ContentType.ContentType,
            );

            let stateForCRDT = stateForSystem.state.get(contentTypeKey);

            if (stateForCRDT === undefined) {
                stateForCRDT = {
                    value: item.value,
                    unixMilliseconds: item.unixMilliseconds,
                    callbacks: new Set(),
                    fulfilled: true,
                };

                stateForSystem.state.set(contentTypeKey, stateForCRDT);
            }

            if (stateForCRDT.unixMilliseconds >= item.unixMilliseconds) {
                continue;
            }

            stateForCRDT.value = item.value;
            stateForCRDT.unixMilliseconds = item.unixMilliseconds;
            stateForCRDT.fulfilled = true;

            stateForCRDT.callbacks.forEach((callback) => {
                callback(stateForCRDT!.value);
            });
        }
    }

    private async loadFromNetwork(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
    ): Promise<void> {
        const systemState = await this._processHandle.loadSystemState(system);

        for (const server of systemState.servers()) {
            try {
                this.loadFromNetworkSpecific(system, contentType, server);
            } catch (err) {
                console.log(err);
            }
        }
    }

    private async loadFromNetworkSpecific(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
        server: string,
    ): Promise<void> {
        const events = await APIMethods.getQueryLatest(server, system, [
            contentType,
        ]);

        for (const event of events.events) {
            this.update(Models.SignedEvent.fromProto(event));
        }
    }

    public update(signedEvent: Models.SignedEvent.SignedEvent): void {
        const event = Models.Event.fromBuffer(signedEvent.event);

        if (event.lwwElement === undefined) {
            return;
        }

        const stateForSystem = this._state.get(
            Models.PublicKey.toString(event.system),
        );

        if (stateForSystem === undefined) {
            return;
        }

        const stateForCRDT = stateForSystem.state.get(
            makeContentTypeKey(event.contentType),
        );

        if (stateForCRDT === undefined) {
            return;
        }

        if (
            stateForCRDT.unixMilliseconds >= event.lwwElement.unixMilliseconds
        ) {
            return;
        }

        stateForCRDT.value = event.lwwElement.value;
        stateForCRDT.unixMilliseconds = event.lwwElement.unixMilliseconds;
        stateForCRDT.fulfilled = true;

        stateForCRDT.callbacks.forEach((callback) => {
            callback(stateForCRDT.value);
        });
    }
}
