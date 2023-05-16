import Long from 'long';
import * as Base64 from '@borderless/base64';

import * as ProcessHandle from './process-handle';
import * as Models from './models';

export type EventQueryCallback
    = (signedEvent: Models.SignedEvent.SignedEvent) => void;

export type CRDTQueryCallback = (value: Uint8Array) => void;

export type UnregisterCallback = () => void;

function makeEventKey(
    system: Models.PublicKey.PublicKey,
    process: Models.Process.Process,
    logicalClock: Long,
): string {
    return system.keyType.toString() +
        Base64.encode(system.key) +
        Base64.encode(process.process) +
        logicalClock.toString();
}

function makeSystemKey(
    system: Models.PublicKey.PublicKey,
): string {
    return system.keyType.toString() + Base64.encode(system.key);
}

function makeContentTypeKey(
    contentType: Models.ContentType.ContentType
): string {
    return contentType.toString();
}

type EventQueryState = {
    signedEvent: Models.SignedEvent.SignedEvent | undefined;
    callbacks: Set<EventQueryCallback>;
};

type StateCRDTQuery = {
    value: Uint8Array;
    unixMilliseconds: Long;
    callbacks: Set<CRDTQueryCallback>;
}

type StateCRDTQuerySystem = {
    queries: Map<string, StateCRDTQuery>;
}

export class View {
    private _eventQueryState: Map<string, EventQueryState>;
    private _stateCRDTQuerySystem: Map<string, StateCRDTQuerySystem>;
    private _processHandle: ProcessHandle.ProcessHandle;

    constructor(
        processHandle: ProcessHandle.ProcessHandle,
    ) {
        this._eventQueryState = new Map();
        this._stateCRDTQuerySystem = new Map();
        this._processHandle = processHandle;

        processHandle.setListener((signedEvent) => {
            this.update(signedEvent);
        });
    }

    public assertClean(): void {
        if (this._eventQueryState.size != 0) {
            throw new Error("eventQueryState not unregistered");
        }

        if (this._stateCRDTQuerySystem.size != 0) {
            throw new Error("stateCRDTQuerySystem not unregistered");
        }
    }

    public registerCRDTQuery(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
        callback: CRDTQueryCallback,
    ): UnregisterCallback {
        const systemKey = makeSystemKey(system);
        const contentTypeKey = makeContentTypeKey(contentType);

        const systemState = this._stateCRDTQuerySystem.get(systemKey);

        const cleanupWrapper = (systemState: StateCRDTQuerySystem) => {
            return () => {
                const queryState = systemState.queries.get(contentTypeKey);

                if (queryState) {
                    queryState.callbacks.delete(callback);

                    if (queryState.callbacks.size == 0) {
                        systemState.queries.delete(contentTypeKey);
                    }
                }

                let found = false;

                for (const query of systemState.queries.values()) {
                    if (query.callbacks.size !== 0) {
                        found = true;

                        break;
                    }
                }

                if (!found) {
                    this._stateCRDTQuerySystem.delete(systemKey);
                }
            };
        };

        if (systemState) {
            const contentTypeKey = makeContentTypeKey(contentType);

            const queryState = systemState.queries.get(contentTypeKey);

            if (queryState) {
                queryState.callbacks.add(callback);

                if (queryState.unixMilliseconds.greaterThan(Long.UZERO)) {
                    callback(queryState.value);
                }
            } else {
                systemState.queries.set(contentTypeKey, {
                    value: new Uint8Array,
                    unixMilliseconds: Long.UZERO,
                    callbacks: new Set([callback]),
                });
            }

            return cleanupWrapper(systemState);
        } else {
            const systemState: StateCRDTQuerySystem = {
                queries: new Map(),
            };

            {
                const contentTypeKey = makeContentTypeKey(contentType);

                systemState.queries.set(contentTypeKey, {
                    value: new Uint8Array,
                    unixMilliseconds: Long.UZERO,
                    callbacks: new Set([callback]),
                });
            }

            this._stateCRDTQuerySystem.set(systemKey, systemState);

            (async () => {
                const systemStateStore = await this._processHandle.store()
                    .getSystemState(system);

                for (const item of systemStateStore.crdtItems) {
                    const contentTypeKey = makeContentTypeKey(
                        item.contentType as Models.ContentType.ContentType,
                    );

                    let queryState = systemState.queries.get(contentTypeKey);

                    if (queryState == undefined) {
                        queryState = {
                            value: item.value,
                            unixMilliseconds: item.unixMilliseconds,
                            callbacks: new Set([]),
                        };

                        systemState.queries.set(contentTypeKey, queryState);

                        if (item.contentType.equals(contentType)) {
                            queryState.callbacks.add(callback);
                        }

                        queryState.callbacks.forEach((callback) => {
                            callback(queryState!.value);
                        });
                    } else if (
                        queryState.unixMilliseconds < item.unixMilliseconds
                    ) {
                        queryState.value = item.value;
                        queryState.unixMilliseconds = item.unixMilliseconds;

                        if (item.contentType.equals(contentType)) {
                            queryState.callbacks.add(callback);
                        }

                        queryState.callbacks.forEach((callback) => {
                            callback(queryState!.value);
                        });
                    }
                }
            })();

            return cleanupWrapper(systemState);
        }
    }

    public registerEventQuery(
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
        logicalClock: Long,
        callback: EventQueryCallback,
    ): UnregisterCallback {
        const key = makeEventKey(system, process, logicalClock);

        const state = this._eventQueryState.get(key);

        const cleanupWrapper = (state: EventQueryState) => {
            return () => {
                state.callbacks.delete(callback);

                if (state.callbacks.size == 0) {
                    this._eventQueryState.delete(key);
                }
            };
        };

        if (state) {
            state.callbacks.add(callback);

            if (state.signedEvent) {
                callback(state.signedEvent);
            }

            return cleanupWrapper(state);
        } else {
            const state: EventQueryState = {
                signedEvent: undefined,
                callbacks: new Set([callback]),
            };

            this._eventQueryState.set(key, state);

            (async () => {
                const signedEvent =
                    await this._processHandle.store().getSignedEvent(
                        system,
                        process,
                        logicalClock,
                    );

                if (signedEvent) {
                    const modelSignedEvent = Models.SignedEvent.fromProto(
                        signedEvent,
                    );

                    state.signedEvent = modelSignedEvent;

                    state.callbacks.forEach((callback) => {
                        callback(modelSignedEvent);
                    });
                }
            })();

            return cleanupWrapper(state);
        }
    }

    public update(
        signedEvent: Models.SignedEvent.SignedEvent,
    ): void {
        const event = Models.Event.fromBuffer(signedEvent.event);

        const key = makeEventKey(
            event.system,
            event.process,
            event.logicalClock,
        );

        const state = this._eventQueryState.get(key);

        if (state) {
            state.callbacks.forEach((callback) => {
                callback(signedEvent);
            });
        }

        if (
            event
                .contentType
                .equals(Models.ContentType.ContentTypeDelete)
        ) {
            const deleteModel = Models.Delete.fromBuffer(event.content);

            const key = makeEventKey(
                event.system,
                deleteModel.process,
                deleteModel.logicalClock,
            );

            const state = this._eventQueryState.get(key);

            if (state) {
                state.signedEvent = signedEvent;

                state.callbacks.forEach((callback) => {
                    callback(signedEvent);
                });
            }
        }

        if (event.lwwElement) {
            const systemState = this._stateCRDTQuerySystem.get(
                makeSystemKey(event.system),
            );

            if (systemState) {
                const queryState = systemState.queries.get(
                    makeContentTypeKey(event.contentType),
                );

                if (
                    queryState &&
                    queryState.unixMilliseconds <
                    event.lwwElement.unixMilliseconds
                ) {
                    queryState.unixMilliseconds =
                        event.lwwElement.unixMilliseconds;

                    queryState.value = event.lwwElement.value;

                    queryState.callbacks.forEach((callback) => {
                        callback(queryState.value);
                    });
                }
            }
        }
    }
}
