import Long from 'long';
import * as RXJS from 'rxjs';

import * as Models from '../models';
import * as Ranges from '../ranges';
import * as Protocol from '../protocol';
import * as APIMethods from '../api-methods';
import { IndexEvents } from '../store/index-events';
import { QueryServers, queryServersObservable } from './query-servers';
import { HasUpdate } from './has-update';
import {
    DuplicatedCallbackError,
    ImpossibleError,
    UnregisterCallback,
} from './shared';
import { CancelContext } from '../cancel-context';

export type Callback = (signedEvent: Models.SignedEvent.SignedEvent) => void;

type StateForEvent = {
    readonly parent: StateForProcess;
    readonly key: LogicalClockString;
    sibling: StateForEvent | undefined;

    readonly logicalClock: Readonly<Long>;
    signedEvent: Models.SignedEvent.SignedEvent | undefined;

    unsubscribe: (() => void) | undefined;
    readonly callbacks: Set<Callback>;
    readonly contextHolds: Set<CancelContext>;
    readonly attemptedSources: Set<string>;
};

export type LogicalClockString = Readonly<string> & {
    readonly __tag: unique symbol;
};

function logicalClockToString(logicalClock: Long): LogicalClockString {
    return logicalClock.toString() as LogicalClockString;
}

type StateForProcess = {
    readonly parent: StateForSystem;
    readonly key: Models.Process.ProcessString;
    readonly process: Models.Process.Process;
    readonly state: Map<LogicalClockString, StateForEvent>;
};

type StateForSystem = {
    readonly key: Models.PublicKey.PublicKeyString;
    readonly state: Map<Models.Process.ProcessString, StateForProcess>;
};

const DeleteOfDeleteError = new Error('cannot delete a delete event');

export class QueryEvent extends HasUpdate {
    private readonly state: Map<
        Models.PublicKey.PublicKeyString,
        StateForSystem
    >;
    private readonly indexEvents: IndexEvents;
    private readonly queryServers: QueryServers;
    private useDisk: boolean;
    private useNetwork: boolean;

    constructor(indexEvents: IndexEvents, queryServers: QueryServers) {
        super();

        this.state = new Map();
        this.indexEvents = indexEvents;
        this.queryServers = queryServers;
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
        process: Models.Process.Process,
        logicalClock: Long,
        callback: Callback,
    ): UnregisterCallback {
        const stateForEvent = this.lookupStateForEvent(
            system,
            process,
            logicalClock,
            true,
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
        }

        if (!stateForEvent.unsubscribe) {
            const toMerge = [];

            if (this.useDisk) {
                toMerge.push(
                    this.loadFromDiskObservable(system, process, logicalClock),
                );
            }

            if (this.useNetwork) {
                toMerge.push(
                    this.loadFromNetworkObservable(
                        stateForEvent.parent.parent,
                        system,
                    ),
                );
            }

            const subscription = RXJS.merge(...toMerge).subscribe(
                (signedEvents) => signedEvents.map(this.update.bind(this)),
            );

            stateForEvent.unsubscribe =
                subscription.unsubscribe.bind(subscription);
        }

        return () => {
            console.log("calling cleanup");
            stateForEvent.callbacks.delete(callback);

            this.cleanupStateForQuery(stateForEvent);
        };
    }

    private loadFromDiskObservable(
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
        logicalClock: Long,
    ): RXJS.Observable<Array<Models.SignedEvent.SignedEvent>> {
        return RXJS.from(
            this.indexEvents.getSignedEvent(system, process, logicalClock),
        ).pipe(
            RXJS.switchMap((signedEvent) =>
                signedEvent ? RXJS.of([signedEvent]) : RXJS.NEVER,
            ),
        );
    }

    private loadFromNetworkObservable(
        stateForSystem: StateForSystem,
        system: Models.PublicKey.PublicKey,
    ): RXJS.Observable<Array<Models.SignedEvent.SignedEvent>> {
        const loadFromServer = (server: string) => {
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
                return RXJS.from(
                    APIMethods.getEvents(server, system, request),
                ).pipe(RXJS.switchMap((events) => RXJS.of(events.events)));
            } else {
                return RXJS.NEVER;
            }
        };

        return RXJS.from(
            queryServersObservable(this.queryServers, system),
        ).pipe(
            RXJS.switchMap((servers) =>
                Array.from(servers).map((server) => loadFromServer(server)),
            ),
            RXJS.mergeAll(),
        );
    }

    private cleanupStateForQuery(stateForEvent: StateForEvent): void {
        const isStateHeldDirectly = (state: StateForEvent) =>
            state.callbacks.size !== 0 || state.contextHolds.size !== 0;

        const cleanupState = (state: StateForEvent) => {
            const stateForProcess = state.parent;

            stateForProcess.state.delete(state.key);

            state.unsubscribe?.();

            if (stateForProcess.state.size === 0) {
                const stateForSystem = stateForProcess.parent;

                stateForSystem.state.delete(stateForProcess.key);

                if (stateForSystem.state.size === 0) {
                    this.state.delete(stateForSystem.key);
                }
            }
        };

        if (
            isStateHeldDirectly(stateForEvent) ||
            (stateForEvent.sibling &&
                isStateHeldDirectly(stateForEvent.sibling))
        ) {
            return;
        }

        cleanupState(stateForEvent);

        if (stateForEvent.sibling) {
            console.log("sibling cleanup");
            cleanupState(stateForEvent.sibling);
        }
    }

    private lookupStateForEvent(
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
        logicalClock: Long,
        createIfMissing: boolean,
    ): StateForEvent | undefined {
        const systemString = Models.PublicKey.toString(system);

        let stateForSystem = this.state.get(systemString);

        if (!stateForSystem) {
            if (createIfMissing) {
                stateForSystem = {
                    key: systemString,
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
                    parent: stateForSystem,
                    key: processString,
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
                    parent: stateForProcess,
                    key: logicalClockString,
                    sibling: undefined,
                    signedEvent: undefined,
                    callbacks: new Set(),
                    contextHolds: new Set(),
                    attemptedSources: new Set(),
                    logicalClock: logicalClock,
                    unsubscribe: undefined,
                };

                stateForProcess.state.set(logicalClockString, stateForEvent);
            } else {
                return undefined;
            }
        }

        return stateForEvent;
    }

    public update(signedEvent: Models.SignedEvent.SignedEvent): void {
        this.updateWithContextHold(signedEvent, undefined);
    }

    public updateWithContextHold(
        signedEvent: Models.SignedEvent.SignedEvent,
        contextHold: CancelContext | undefined,
    ): void {
        const event = Models.Event.fromBuffer(signedEvent.event);

        let stateMustBeCreated = false;

        if (event.contentType.equals(Models.ContentType.ContentTypeDelete)) {
            const deleteModel = Models.Delete.fromBuffer(event.content);

            if (
                this.lookupStateForEvent(
                    event.system,
                    deleteModel.process,
                    deleteModel.logicalClock,
                    false,
                )
            ) {
                stateMustBeCreated = true;
            }
        }

        const stateForEvent = this.lookupStateForEvent(
            event.system,
            event.process,
            event.logicalClock,
            !!contextHold || stateMustBeCreated,
        );

        if (!stateForEvent) {
            return;
        }

        if (contextHold) {
            stateForEvent.contextHolds.add(contextHold);

            contextHold.addCallback(() => {
                stateForEvent.contextHolds.delete(contextHold);

                this.cleanupStateForQuery(stateForEvent);
            });
        }

        if (event.contentType.equals(Models.ContentType.ContentTypeDelete)) {
            const deleteModel = Models.Delete.fromBuffer(event.content);

            const stateForDeletedEvent = this.lookupStateForEvent(
                event.system,
                deleteModel.process,
                deleteModel.logicalClock,
                true,
            );

            if (!stateForDeletedEvent) {
                throw ImpossibleError;
            }

            if (stateForDeletedEvent.signedEvent) {
                const deletedEvent = Models.Event.fromBuffer(
                    stateForDeletedEvent.signedEvent.event,
                );

                if (
                    event.contentType.equals(
                        Models.ContentType.ContentTypeDelete,
                    ) &&
                    deletedEvent.contentType.equals(
                        Models.ContentType.ContentTypeDelete,
                    )
                ) {
                    throw DeleteOfDeleteError;
                }
            }

            stateForEvent.sibling = stateForDeletedEvent;
            stateForDeletedEvent.sibling = stateForEvent;
            stateForDeletedEvent.signedEvent = signedEvent;
            stateForDeletedEvent.callbacks.forEach((cb) => cb(signedEvent));
        }

        if (!stateForEvent.signedEvent) {
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
