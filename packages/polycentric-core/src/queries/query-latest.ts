import * as RXJS from 'rxjs';

import * as APIMethods from '../api-methods';
import * as Models from '../models';
import {
    UnregisterCallback,
    DuplicatedCallbackError,
    ImpossibleError,
} from './shared';
import * as Util from '../util';
import { ProcessHandle } from '../process-handle';
import * as QueryHead from './query-head2';
import { OnceFlag } from '../util';
import { CancelContext } from '../cancel-context';
import { HasUpdate } from './has-update';

export type Callback = (
    values: ReadonlyMap<
        Models.Process.ProcessString,
        Models.SignedEvent.SignedEvent
    >,
) => void;

type StateForContentType = {
    readonly fulfilled: OnceFlag;
    readonly values: Map<
        Models.Process.ProcessString,
        Models.SignedEvent.SignedEvent
    >;
    readonly callbacks: Set<Callback>;
    readonly contextHolds: Set<CancelContext>;
    readonly unsubscribe: () => void;
    readonly attemptedSources: Set<string>;
};

type StateForSystem = {
    readonly stateForContentType: Map<
        Models.ContentType.ContentTypeString,
        StateForContentType
    >;
};

export class QueryLatest extends HasUpdate {
    private readonly state: Map<
        Models.PublicKey.PublicKeyString,
        StateForSystem
    >;
    private readonly queryHead: QueryHead.QueryHead;
    private readonly processHandle: ProcessHandle;
    private useDisk: boolean;
    private useNetwork: boolean;

    constructor(processHandle: ProcessHandle, queryHead: QueryHead.QueryHead) {
        super();

        this.state = new Map();
        this.queryHead = queryHead;
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
        contentType: Models.ContentType.ContentType,
        callback: Callback,
    ): UnregisterCallback {
        const systemString = Models.PublicKey.toString(system);

        const stateForSystem: StateForSystem = Util.lookupWithInitial(
            this.state,
            systemString,
            () => {
                return {
                    stateForContentType: new Map(),
                };
            },
        );

        const contentTypeString = Models.ContentType.toString(contentType);

        let initial = false;

        const stateForContentType: StateForContentType = Util.lookupWithInitial(
            stateForSystem.stateForContentType,
            contentTypeString,
            () => {
                initial = true;

                const toMerge = [];

                if (this.useDisk) {
                    toMerge.push(this.loadFromDisk(system, contentType));
                }

                if (this.useNetwork) {
                    toMerge.push(
                        this.loadFromNetwork(
                            stateForSystem,
                            system,
                            contentType,
                        ),
                    );
                }

                const subscription = RXJS.merge(...toMerge).subscribe(
                    this.updateBatch.bind(this, undefined),
                );

                return {
                    fulfilled: new OnceFlag(),
                    values: new Map(),
                    callbacks: new Set([callback]),
                    contextHolds: new Set(),
                    unsubscribe: subscription.unsubscribe.bind(subscription),
                    attemptedSources: new Set(),
                };
            },
        );

        if (!initial) {
            if (stateForContentType.callbacks.has(callback)) {
                throw DuplicatedCallbackError;
            }

            stateForContentType.callbacks.add(callback);

            if (stateForContentType.fulfilled.value) {
                callback(stateForContentType.values);
            }
        }

        return () => {
            stateForContentType.callbacks.delete(callback);

            this.cleanup(
                system,
                contentType,
                stateForSystem,
                stateForContentType,
            );
        };
    }

    private cleanup(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
        stateForSystem: StateForSystem,
        stateForContentType: StateForContentType,
    ): void {
        if (
            stateForContentType.callbacks.size === 0 &&
            stateForContentType.contextHolds.size === 0
        ) {
            const contentTypeString = Models.ContentType.toString(contentType);
            const systemString = Models.PublicKey.toString(system);

            stateForContentType.unsubscribe();

            stateForSystem.stateForContentType.delete(contentTypeString);

            if (stateForSystem.stateForContentType.size === 0) {
                this.state.delete(systemString);
            }
        }
    }

    private loadFromDisk(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
    ): RXJS.Observable<Array<Models.SignedEvent.SignedEvent>> {
        const loadFromDisk = async (
            signedEvent: Models.SignedEvent.SignedEvent,
        ) =>
            await this.processHandle
                .store()
                .indexSystemProcessContentTypeLogicalClock.getLatest(
                    system,
                    Models.Event.fromBuffer(signedEvent.event).process,
                    contentType,
                );

        return QueryHead.queryHeadObservable(this.queryHead, system).pipe(
            RXJS.switchMap((head) =>
                RXJS.combineLatest(
                    Util.mapToArray(head, (signedEvent) =>
                        RXJS.from(loadFromDisk(signedEvent)),
                    ),
                ),
            ),
            RXJS.switchMap((signedEvents) =>
                RXJS.of(
                    signedEvents.filter(
                        (
                            signedEvent,
                        ): signedEvent is Models.SignedEvent.SignedEvent =>
                            !!signedEvent,
                    ),
                ),
            ),
        );
    }

    private loadFromNetwork(
        stateForSystem: StateForSystem,
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
    ): RXJS.Observable<Array<Models.SignedEvent.SignedEvent>> {
        const loadServerList = async () =>
            (await this.processHandle.loadSystemState(system)).servers();

        const loadFromServer = async (server: string) => {
            const need = [];

            for (const [
                contentType,
                state,
            ] of stateForSystem.stateForContentType.entries()) {
                if (!state.attemptedSources.has(server)) {
                    state.attemptedSources.add(server);
                    need.push(Models.ContentType.fromString(contentType));
                }
            }

            return (await APIMethods.getQueryLatest(server, system, need))
                .events;
        };

        return RXJS.from(loadServerList()).pipe(
            RXJS.switchMap((servers) =>
                servers.map((server) => RXJS.from(loadFromServer(server))),
            ),
            RXJS.mergeAll(),
        );
    }

    public update(signedEvent: Models.SignedEvent.SignedEvent): void {
        this.updateBatch(undefined, [signedEvent]);
    }

    public updateBatch(
        contextHold: CancelContext | undefined,
        signedEvents: Array<Models.SignedEvent.SignedEvent>,
    ): void {
        const updatedStates = new Set<StateForContentType>();

        for (const signedEvent of signedEvents) {
            const event = Models.Event.fromBuffer(signedEvent.event);

            const systemString = Models.PublicKey.toString(event.system);

            let stateForSystem = this.state.get(systemString);

            if (!stateForSystem) {
                if (contextHold) {
                    stateForSystem = {
                        stateForContentType: new Map(),
                    };

                    this.state.set(systemString, stateForSystem);
                } else {
                    continue;
                }
            }

            const contentTypeString = Models.ContentType.toString(
                event.contentType,
            );

            let stateForContentType =
                stateForSystem.stateForContentType.get(contentTypeString);

            if (!stateForContentType) {
                if (contextHold) {
                    stateForContentType = {
                        fulfilled: new OnceFlag(),
                        values: new Map(),
                        callbacks: new Set(),
                        contextHolds: new Set(),
                        unsubscribe: () => {},
                        attemptedSources: new Set(),
                    };

                    stateForSystem.stateForContentType.set(
                        contentTypeString,
                        stateForContentType,
                    );
                } else {
                    continue;
                }
            }

            if (contextHold) {
                stateForContentType.contextHolds.add(contextHold);

                contextHold.addCallback(() => {
                    if (!stateForContentType) {
                        throw ImpossibleError;
                    }

                    stateForContentType.contextHolds.delete(contextHold);

                    if (!stateForSystem) {
                        throw ImpossibleError;
                    }

                    this.cleanup(
                        event.system,
                        event.contentType,
                        stateForSystem,
                        stateForContentType,
                    );
                });
            }

            const processString = Models.Process.toString(event.process);

            const latestForProcess =
                stateForContentType.values.get(processString);

            if (
                !latestForProcess ||
                event.logicalClock.greaterThan(
                    Models.Event.fromBuffer(latestForProcess.event)
                        .logicalClock,
                )
            ) {
                stateForContentType.values.set(processString, signedEvent);
                stateForContentType.fulfilled.set();
                updatedStates.add(stateForContentType);
            }
        }

        for (const state of updatedStates) {
            for (const callback of state.callbacks) {
                callback(state.values);
            }
        }
    }
}

export function queryLatestObservable(
    queryManager: QueryLatest,
    system: Models.PublicKey.PublicKey,
    contentType: Models.ContentType.ContentType,
): RXJS.Observable<
    ReadonlyMap<Models.Process.ProcessString, Models.SignedEvent.SignedEvent>
> {
    return new RXJS.Observable((subscriber) => {
        return queryManager.query(system, contentType, (signedEvents) => {
            subscriber.next(signedEvents);
        });
    });
}
