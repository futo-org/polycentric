import Long from 'long';
import * as Base64 from '@borderless/base64';
import * as RXJS from 'rxjs';

import * as Models from '../models';
import * as Shared from './shared';
import * as Ranges from '../ranges';
import * as Protocol from '../protocol';
import * as APIMethods from '../api-methods';
import { IndexEvents } from '../store/index-events';
import { ProcessHandle } from '../process-handle';
import { HasUpdate } from './has-update';

export type Callback = (signedEvent: Models.SignedEvent.SignedEvent) => void;

export type ContextHold = {
    readonly __tag: unique symbol;
};

type StateForEvent = {
    readonly logicalClock: Readonly<Long>;
    signedEvent: Models.SignedEvent.SignedEvent | undefined;
    readonly callbacks: Set<Callback>;
    readonly contextHolds: Set<ContextHold>;
    readonly attemptedSources: Set<string>;
};

export type LogicalClockString = Readonly<string> & {
    readonly __tag: unique symbol;
};

function logicalClockToString(logicalClock: Long): LogicalClockString {
    return logicalClock.toString() as LogicalClockString;
}

type StateForProcess = {
    readonly process: Models.Process.Process;
    readonly state: Map<LogicalClockString, StateForEvent>;
};

type StateForSystem = {
    readonly state: Map<Models.Process.ProcessString, StateForProcess>;
};

const DuplicatedCallbackError = new Error('duplicated callback');
const ImpossibleError = new Error('impossible');
const DeleteOfDeleteError = new Error('cannot delete a delete event');

export class QueryEvent extends HasUpdate {
    private readonly state: Map<
        Models.PublicKey.PublicKeyString,
        StateForSystem
    >;
    private readonly indexEvents: IndexEvents;
    private readonly processHandle: ProcessHandle;
    private useDisk: boolean;
    private useNetwork: boolean;

    constructor(processHandle: ProcessHandle, indexEvents: IndexEvents) {
        super();

        this.state = new Map();
        this.indexEvents = indexEvents;
        this.processHandle = processHandle;
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
        process: Models.Process.Process,
        logicalClock: Long,
        callback: Callback,
    ): Shared.UnregisterCallback {
        const stateForEvent = this.lookupStateForEvent(
            system,
            process,
            logicalClock,
            true,
            false,
        );

        if (!stateForEvent) {
            throw ImpossibleError;
        }

        if (stateForEvent.callbacks.has(callback)) {
            throw DuplicatedCallbackError;
        }

        stateForEvent.callbacks.add(callback);

        if (stateForEvent.signedEvent) {
            callback(stateForEvent.signedEvent);
        } else {
            if (this.useDisk) {
                this.loadFromDisk(stateForEvent, system, process, logicalClock);
            }

            if (this.useNetwork) {
                this.loadFromNetwork(
                    stateForEvent,
                    system,
                    process,
                    logicalClock,
                );
            }
        }

        return () => {
            this.cleanupStateForQuery(
                stateForEvent,
                system,
                process,
                logicalClock,
            );
        };
    }

    private async loadFromDisk(
        stateForEvent: StateForEvent,
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
        logicalClock: Long,
    ): Promise<void> {
        if (stateForEvent.attemptedSources.has('disk')) {
            return;
        }

        stateForEvent.attemptedSources.add('disk');

        const signedEvent = await this.indexEvents.getSignedEvent(
            system,
            process,
            logicalClock,
        );

        if (signedEvent) {
            this.update(signedEvent);
        }
    }

    private async loadFromNetwork(
        stateForEvent: StateForEvent,
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
        logicalClock: Long,
    ): Promise<void> {
        const systemState = await this.processHandle.loadSystemState(system);

        const systemString = Models.PublicKey.toString(system);
        const stateForSystem = this.state.get(systemString);

        if (stateForSystem == undefined) {
            throw ImpossibleError;
        }

        for (const server of systemState.servers()) {
            const request: Protocol.RangesForSystem = {
                rangesForProcesses: [],
            };

            for (const stateForProcess of stateForSystem.state.values()) {
                const rangesForProcess = {
                    process: stateForProcess.process,
                    ranges: [],
                };

                for (const stateForEvent of stateForProcess.state.values()) {
                    if (!stateForEvent.attemptedSources.has(server)) {
                        stateForEvent.attemptedSources.add(server);

                        Ranges.insert(
                            rangesForProcess.ranges,
                            stateForEvent.logicalClock,
                        );
                    }
                }

                if (rangesForProcess.ranges.length > 0) {
                    request.rangesForProcesses.push(rangesForProcess);
                }
            }

            if (request.rangesForProcesses.length > 0) {
                (async () => {
                    const events = await APIMethods.getEvents(
                        server,
                        system,
                        request,
                    );

                    events.events.forEach((event) => this.update(event));
                })();
            }
        }
    }

    private cleanupStateForQuery(
        stateForEvent: StateForEvent,
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
        logicalClock: Long,
    ): void {
        if (stateForEvent.signedEvent) {
            const event = Models.Event.fromBuffer(
                stateForEvent.signedEvent.event,
            );

            if (
                event.contentType.equals(Models.ContentType.ContentTypeDelete)
            ) {
                if (
                    Models.PublicKey.equal(system, event.system) &&
                    Models.Process.equal(process, event.process) &&
                    logicalClock.equals(event.logicalClock)
                ) {
                    this.lookupStateForEvent(
                        system,
                        event.process,
                        event.logicalClock,
                        false,
                        true,
                    );
                } else {
                    const deleteModel = Models.Delete.fromBuffer(event.content);

                    this.lookupStateForEvent(
                        system,
                        deleteModel.process,
                        deleteModel.logicalClock,
                        false,
                        true,
                    );
                }
            }
        }

        this.lookupStateForEvent(system, process, logicalClock, false, true);
    }

    private lookupStateForEvent(
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
        logicalClock: Long,
        createIfMissing: boolean,
        cleanup: boolean,
    ): StateForEvent | undefined {
        const systemString = Models.PublicKey.toString(system);

        let stateForSystem = this.state.get(systemString);

        if (!stateForSystem) {
            if (createIfMissing) {
                stateForSystem = {
                    state: new Map(),
                };

                this.state.set(systemString, stateForSystem);
            } else {
                return undefined;
            }
        }

        const processString = Models.Process.toString(process);

        let stateForProcess = stateForSystem.state.get(processString);

        if (!stateForProcess) {
            if (createIfMissing) {
                stateForProcess = {
                    process: process,
                    state: new Map(),
                };

                stateForSystem.state.set(processString, stateForProcess);
            } else {
                return undefined;
            }
        }

        const logicalClockString = logicalClockToString(logicalClock);

        let stateForEvent = stateForProcess.state.get(logicalClockString);

        if (!stateForEvent) {
            if (createIfMissing) {
                stateForEvent = {
                    signedEvent: undefined,
                    callbacks: new Set(),
                    contextHolds: new Set(),
                    attemptedSources: new Set(),
                    logicalClock: logicalClock,
                };

                stateForProcess.state.set(logicalClockString, stateForEvent);
            } else {
                return undefined;
            }
        }

        if (!cleanup) {
            return stateForEvent;
        }

        if (
            stateForEvent.callbacks.size === 0 &&
            stateForEvent.contextHolds.size === 0
        ) {
            stateForProcess.state.delete(logicalClockString);
        } else {
            return undefined;
        }

        if (stateForProcess.state.size === 0) {
            stateForSystem.state.delete(processString);
        } else {
            return undefined;
        }

        if (stateForSystem.state.size === 0) {
            this.state.delete(systemString);
        }

        return undefined;
    }

    public update(signedEvent: Models.SignedEvent.SignedEvent): void {
        this.updateWithContextHold(signedEvent, undefined);
    }

    public updateWithContextHold(
        signedEvent: Models.SignedEvent.SignedEvent,
        contextHold: ContextHold | undefined,
    ): void {
        const event = Models.Event.fromBuffer(signedEvent.event);

        const stateForEvent = this.lookupStateForEvent(
            event.system,
            event.process,
            event.logicalClock,
            contextHold !== undefined,
            false,
        );

        if (!stateForEvent) {
            return;
        }

        if (contextHold) {
            stateForEvent.contextHolds.add(contextHold);
        }

        if (!stateForEvent.signedEvent) {
            stateForEvent.signedEvent = signedEvent;
            stateForEvent.callbacks.forEach((cb) => cb(signedEvent));
        } else {
            const cachedEvent = Models.Event.fromBuffer(
                stateForEvent.signedEvent.event,
            );

            if (
                event.contentType.equals(
                    Models.ContentType.ContentTypeDelete,
                ) &&
                cachedEvent.contentType.equals(
                    Models.ContentType.ContentTypeDelete,
                )
            ) {
                throw DeleteOfDeleteError;
            }
        }

        if (event.contentType.equals(Models.ContentType.ContentTypeDelete)) {
            const deleteModel = Models.Delete.fromBuffer(event.content);

            const stateForEvent = this.lookupStateForEvent(
                event.system,
                deleteModel.process,
                deleteModel.logicalClock,
                true,
                false,
            );

            if (!stateForEvent) {
                throw ImpossibleError;
            }

            stateForEvent.signedEvent = signedEvent;
            stateForEvent.callbacks.forEach((cb) => cb(signedEvent));
        }
    }
}

export function queryEventObservable(
    queryManager: QueryEvent,
    system: Models.PublicKey.PublicKey,
    process: Models.Process.Process,
    logicalClock: Long,
): RXJS.Observable<Models.SignedEvent.SignedEvent> {
    return new RXJS.Observable((subscriber) => {
        return queryManager.query(
            system,
            process,
            logicalClock,
            (signedEvent) => {
                subscriber.next(signedEvent);
            },
        );
    });
}
