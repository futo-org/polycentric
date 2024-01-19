import Long from 'long';
import * as RXJS from 'rxjs';

import * as APIMethods from '../api-methods';
import * as Models from '../models';
import * as ProcessHandle from '../process-handle';
import * as Synchronization from '../synchronization';
import * as Shared from './shared';

export type SuccessCallback = (value: Uint8Array) => void;
export type NotYetFoundCallback = () => void;

type StateForCRDT = {
    value: Uint8Array;
    unixMilliseconds: Long;
    readonly successCallbacks: Set<SuccessCallback>;
    readonly notYetFoundCallbacks: Set<NotYetFoundCallback>;
    fulfilled: boolean;
};

type StateForSystem = {
    readonly state: Map<string, StateForCRDT>;
};

function makeContentTypeKey(
    contentType: Models.ContentType.ContentType,
): string {
    return contentType.toString();
}

export class QueryManager {
    private readonly _processHandle: ProcessHandle.ProcessHandle;
    private readonly _state: Map<
        Models.PublicKey.PublicKeyString,
        StateForSystem
    >;
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
        successCallback: SuccessCallback,
        notYetFoundCallback?: NotYetFoundCallback,
    ): Shared.UnregisterCallback {
        const systemString = Models.PublicKey.toString(system);

        let stateForSystem = this._state.get(systemString);

        if (stateForSystem === undefined) {
            stateForSystem = {
                state: new Map<string, StateForCRDT>(),
            };

            this._state.set(systemString, stateForSystem);
        }

        const contentTypeString = makeContentTypeKey(contentType);

        let stateForCRDT = stateForSystem.state.get(contentTypeString);

        if (stateForCRDT === undefined) {
            stateForCRDT = {
                value: new Uint8Array(),
                unixMilliseconds: Long.UZERO,
                successCallbacks: new Set(),
                notYetFoundCallbacks: new Set(),
                fulfilled: false,
            };

            stateForSystem.state.set(contentTypeString, stateForCRDT);
        }

        stateForCRDT.successCallbacks.add(successCallback);
        if (notYetFoundCallback) {
            stateForCRDT.notYetFoundCallbacks.add(notYetFoundCallback);
        }

        if (stateForCRDT.fulfilled === true) {
            successCallback(stateForCRDT.value);
        } else {
            let networkLoadPromise: Promise<void> | undefined;
            if (this._useNetwork === true) {
                networkLoadPromise = this.loadFromNetwork(system, contentType);
            }

            let diskLoadPromise: Promise<void> | undefined;
            if (this._useDisk === true) {
                diskLoadPromise = this.loadFromDisk(system);
            }

            Promise.allSettled([networkLoadPromise, diskLoadPromise]).then(
                () => {
                    if (!stateForCRDT) {
                        console.error('Impossible');
                    }
                    if (stateForCRDT?.fulfilled === false) {
                        stateForCRDT.notYetFoundCallbacks.forEach(
                            (callback) => {
                                callback();
                            },
                        );
                    }
                },
            );
        }

        return () => {
            if (stateForCRDT !== undefined && stateForSystem !== undefined) {
                stateForCRDT.successCallbacks.delete(successCallback);

                let found = false;

                for (const query of stateForSystem.state.values()) {
                    if (query.successCallbacks.size !== 0) {
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
            .indexSystemStates.getSystemState(system);

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

            const stateForCRDT = (() => {
                const existingState = stateForSystem.state.get(contentTypeKey);

                if (existingState === undefined) {
                    const initialState = {
                        value: item.value,
                        unixMilliseconds: item.unixMilliseconds,
                        successCallbacks: new Set<SuccessCallback>(),
                        notYetFoundCallbacks: new Set<NotYetFoundCallback>(),
                        fulfilled: true,
                    };

                    stateForSystem.state.set(contentTypeKey, initialState);

                    return initialState;
                } else {
                    return existingState;
                }
            })();

            if (stateForCRDT.unixMilliseconds >= item.unixMilliseconds) {
                continue;
            }

            stateForCRDT.value = item.value;
            stateForCRDT.unixMilliseconds = item.unixMilliseconds;
            stateForCRDT.fulfilled = true;

            stateForCRDT.successCallbacks.forEach((callback) => {
                callback(stateForCRDT.value);
            });
        }
    }

    private async loadFromNetwork(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
    ): Promise<void> {
        const systemState = await this._processHandle.loadSystemState(system);

        const loadPromises = systemState.servers().map((server) =>
            this.loadFromNetworkSpecific(system, contentType, server).catch(
                (err) => {
                    console.error(err);
                },
            ),
        );
        await Promise.allSettled(loadPromises);
    }

    private async loadFromNetworkSpecific(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
        server: string,
    ): Promise<void> {
        const events = await APIMethods.getQueryLatest(server, system, [
            contentType,
        ]);

        events.events.forEach((x) => this.update(x));
        Synchronization.saveBatch(this._processHandle, events);
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

        stateForCRDT.successCallbacks.forEach((callback) => {
            callback(stateForCRDT.value);
        });
    }
}

export function observableQuery(
    queryManager: QueryManager,
    system: Models.PublicKey.PublicKey,
    contentType: Models.ContentType.ContentType,
): RXJS.Observable<Uint8Array | undefined> {
    return new RXJS.Observable((subscriber) => {
        return queryManager.query(
            system,
            contentType,
            (value) => {
                subscriber.next(value);
            },
            () => {
                subscriber.next(undefined);
            },
        );
    });
}
