import * as RXJS from 'rxjs';

import * as APIMethods from '../api-methods';
import * as Models from '../models';
import {
    UnregisterCallback,
    DuplicatedCallbackError,
    ImpossibleError,
} from './shared';
import * as Util from '../util';
import * as QueryHead from './query-head';
import { OnceFlag } from '../util';
import { CancelContext } from '../cancel-context';
import { HasUpdate } from './has-update';
import { QueryServers, queryServersObservable } from './query-servers';
import { IndexSystemProcessContentTypeClock } from '../store/index-system-process-content-type-clock';

export type Callback = (
    values: ReadonlyMap<
        Models.Process.ProcessString,
        Models.SignedEvent.SignedEvent
    >,
) => void;

interface StateForContentType {
    readonly key: Models.ContentType.ContentTypeString;
    readonly contentType: Models.ContentType.ContentType;
    readonly fulfilled: OnceFlag;
    readonly values: Map<
        Models.Process.ProcessString,
        Models.SignedEvent.SignedEvent
    >;
    readonly callbacks: Set<Callback>;
    readonly contextHolds: Set<CancelContext>;
    unsubscribe: (() => void) | undefined;
    readonly attemptedSources: Set<string>;
}

interface StateForSystem {
    readonly stateForContentType: Map<
        Models.ContentType.ContentTypeString,
        StateForContentType
    >;
}

interface BatchForContentTypeState {
    readonly stateForContentType: StateForContentType;
    readonly batch: Models.SignedEvent.SignedEvent[];
}

interface AttemptedBatch {
    readonly batchByContentType: Map<
        Models.ContentType.ContentTypeString,
        BatchForContentTypeState
    >;
}

function makeAttemptedBatch(
    attemptedStates: ReadonlySet<StateForContentType>,
    signedEvents: readonly Models.SignedEvent.SignedEvent[],
): AttemptedBatch {
    const result: AttemptedBatch = {
        batchByContentType: new Map(),
    };

    for (const stateForContentType of attemptedStates) {
        result.batchByContentType.set(stateForContentType.key, {
            stateForContentType: stateForContentType,
            batch: [],
        });
    }

    for (const signedEvent of signedEvents) {
        const event = Models.Event.fromBuffer(signedEvent.event);

        let batchByContentType: BatchForContentTypeState | undefined =
            undefined;

        if (event.contentType.equals(Models.ContentType.ContentTypeDelete)) {
            const deleteBody = Models.Delete.fromBuffer(event.content);

            batchByContentType = result.batchByContentType.get(
                Models.ContentType.toString(deleteBody.contentType),
            );
        } else {
            batchByContentType = result.batchByContentType.get(
                Models.ContentType.toString(event.contentType),
            );
        }

        if (batchByContentType === undefined) {
            continue;
        }

        batchByContentType.batch.push(signedEvent);
    }

    return result;
}

export class QueryLatest extends HasUpdate {
    private readonly state: Map<
        Models.PublicKey.PublicKeyString,
        StateForSystem
    >;
    private readonly queryHead: QueryHead.QueryHead;
    private readonly queryServers: QueryServers;
    private readonly index: IndexSystemProcessContentTypeClock;
    private useDisk: boolean;
    private useNetwork: boolean;
    private getQueryLatest: APIMethods.GetQueryLatestType;

    constructor(
        index: IndexSystemProcessContentTypeClock,
        queryServers: QueryServers,
        queryHead: QueryHead.QueryHead,
    ) {
        super();

        this.state = new Map();
        this.index = index;
        this.queryHead = queryHead;
        this.queryServers = queryServers;
        this.useDisk = true;
        this.useNetwork = true;
        this.getQueryLatest = APIMethods.getQueryLatest;
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

    public setGetQueryLatest(
        getQueryLatest: APIMethods.GetQueryLatestType,
    ): void {
        this.getQueryLatest = getQueryLatest;
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

                return {
                    key: contentTypeString,
                    contentType: contentType,
                    fulfilled: new OnceFlag(),
                    values: new Map(),
                    callbacks: new Set(),
                    contextHolds: new Set(),
                    unsubscribe: undefined,
                    attemptedSources: new Set(),
                };
            },
        );

        if (stateForContentType.callbacks.has(callback)) {
            throw DuplicatedCallbackError;
        }

        stateForContentType.callbacks.add(callback);

        if (stateForContentType.fulfilled.value) {
            callback(stateForContentType.values);
        }

        /* eslint @typescript-eslint/no-unnecessary-condition: 0 */
        if (initial) {
            const toMerge = [];

            if (this.useDisk) {
                toMerge.push(this.loadFromDisk(stateForContentType, system));
            }

            if (this.useNetwork) {
                toMerge.push(this.loadFromNetwork(stateForSystem, system));
            }

            const subscription = RXJS.merge(...toMerge).subscribe(
                this.updateAttemptedBatch.bind(this),
            );

            stateForContentType.unsubscribe =
                subscription.unsubscribe.bind(subscription);
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

            stateForContentType.unsubscribe?.();

            stateForSystem.stateForContentType.delete(contentTypeString);

            if (stateForSystem.stateForContentType.size === 0) {
                this.state.delete(systemString);
            }
        }
    }

    private loadFromDisk(
        stateForContentType: StateForContentType,
        system: Models.PublicKey.PublicKey,
    ): RXJS.Observable<AttemptedBatch> {
        const loadFromDisk = (process: Models.Process.Process) =>
            RXJS.from(
                this.index.getLatest(
                    system,
                    process,
                    stateForContentType.contentType,
                ),
            );

        const getLatest = (headSignedEvent: Models.SignedEvent.SignedEvent) => {
            const headEvent = Models.Event.fromBuffer(headSignedEvent.event);

            if (headEvent.contentType.equals(stateForContentType.contentType)) {
                return RXJS.of(headSignedEvent);
            } else if (
                Models.Event.lookupIndex(
                    headEvent,
                    stateForContentType.contentType,
                )
            ) {
                return loadFromDisk(headEvent.process);
            } else {
                return RXJS.of(undefined);
            }
        };

        const makeAttempt = (
            signedEvents: (Models.SignedEvent.SignedEvent | undefined)[],
        ): AttemptedBatch => {
            return {
                batchByContentType: new Map([
                    [
                        stateForContentType.key,
                        {
                            stateForContentType: stateForContentType,
                            batch: Util.filterUndefined(signedEvents),
                        },
                    ],
                ]),
            };
        };

        return QueryHead.queryHeadObservable(this.queryHead, system).pipe(
            RXJS.switchMap((head) =>
                head.head.size > 0
                    ? RXJS.combineLatest(
                          Util.mapToArray(head.head, (signedEvent) =>
                              getLatest(signedEvent),
                          ),
                      )
                    : RXJS.of([]),
            ),
            RXJS.switchMap((signedEvents) =>
                RXJS.of(makeAttempt(signedEvents)),
            ),
        );
    }

    private loadFromNetwork(
        stateForSystem: StateForSystem,
        system: Models.PublicKey.PublicKey,
    ): RXJS.Observable<AttemptedBatch> {
        const loadFromServer = async (server: string) => {
            const needToUpdateStates = new Set<StateForContentType>();

            for (const state of stateForSystem.stateForContentType.values()) {
                if (!state.attemptedSources.has(server)) {
                    state.attemptedSources.add(server);
                    needToUpdateStates.add(state);
                }
            }

            if (needToUpdateStates.size === 0) {
                return {
                    batchByContentType: new Map(),
                };
            }

            const needContentTypes = Array.from(needToUpdateStates).map(
                (state) => state.contentType,
            );

            const response = await this.getQueryLatest(
                server,
                system,
                needContentTypes,
            );

            return makeAttemptedBatch(needToUpdateStates, response.events);
        };

        return queryServersObservable(this.queryServers, system).pipe(
            RXJS.switchMap((servers: ReadonlySet<string>) =>
                RXJS.of(...Array.from(servers)),
            ),
            RXJS.distinct(),
            RXJS.mergeMap((server: string) =>
                Util.asyncBoundaryObservable(server).pipe(
                    RXJS.switchMap((server) =>
                        RXJS.from(loadFromServer(server)).pipe(
                            RXJS.catchError(() => RXJS.NEVER),
                        ),
                    ),
                ),
            ),
        );
    }

    public update(signedEvent: Models.SignedEvent.SignedEvent): void {
        this.updateBatch(undefined, [signedEvent]);
    }

    public updateWithContextHold(
        signedEvent: Models.SignedEvent.SignedEvent,
        contextHold: CancelContext | undefined,
    ): void {
        this.updateBatch(contextHold, [signedEvent]);
    }

    private updateBatchEmpty(stateForContentType: StateForContentType): void {
        stateForContentType.fulfilled.set();

        for (const callback of stateForContentType.callbacks) {
            callback(stateForContentType.values);
        }
    }

    private updateAttemptedBatch(attemptedBatch: AttemptedBatch): void {
        for (const attempt of attemptedBatch.batchByContentType.values()) {
            if (attempt.batch.length === 0) {
                this.updateBatchEmpty(attempt.stateForContentType);
            } else {
                this.updateBatch(undefined, attempt.batch);
            }
        }
    }

    public updateBatch(
        contextHold: CancelContext | undefined,
        signedEvents: Models.SignedEvent.SignedEvent[],
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
                        key: contentTypeString,
                        contentType: event.contentType,
                        fulfilled: new OnceFlag(),
                        values: new Map(),
                        callbacks: new Set(),
                        contextHolds: new Set(),
                        unsubscribe: undefined,
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
