import Long from 'long';
import * as RXJS from 'rxjs';

import * as Models from '../models';
import * as Util from '../util';
import * as Protocol from '../protocol';
import * as QueryHead from './query-head2';
import { UnregisterCallback, DuplicatedCallbackError } from './shared';
import { Box } from '../util';
import { QueryLatest, queryLatestObservable } from './query-latest';

export type SuccessCallback = (value: Uint8Array | undefined) => void;

type StateForCRDT = {
    readonly value: Box<Uint8Array | undefined>;
    readonly callbacks: Set<SuccessCallback>;
    readonly fulfilled: Box<boolean>;
    readonly unsubscribe: () => void;
};

type StateForSystem = {
    readonly state: Map<Models.ContentType.ContentTypeString, StateForCRDT>;
};

function lookupIndex(
    indices: Protocol.Indices,
    contentType: Models.ContentType.ContentType,
): Long | undefined {
    for (const index of indices.indices) {
        if (index.indexType.equals(contentType)) {
            return index.logicalClock;
        }
    }

    return undefined;
}

function computeCRDTValue(
    head: QueryHead.CallbackValue,
    latestEvents: ReadonlyMap<
        Models.Process.ProcessString,
        Models.SignedEvent.SignedEvent
    >,
    contentType: Models.ContentType.ContentType,
): Uint8Array | undefined {
    const signedEvents = Array.from(latestEvents.values());

    const events = signedEvents
        .filter(
            (signedEvent): signedEvent is Models.SignedEvent.SignedEvent =>
                !!signedEvent,
        )
        .map((signedEvent) => Models.Event.fromBuffer(signedEvent.event))
        .filter((event) => event.contentType.equals(contentType));

    let latestTime: Long = Long.UZERO;
    let result: Uint8Array | undefined = undefined;

    for (const event of events) {
        if (event.unixMilliseconds && event.lwwElement) {
            if (event.unixMilliseconds.greaterThanOrEqual(latestTime)) {
                latestTime = event.unixMilliseconds;
                result = event.lwwElement.value;
            }
        }
    }

    return result;
}

export class QueryCRDT {
    private readonly state: Map<
        Models.PublicKey.PublicKeyString,
        StateForSystem
    >;
    private readonly queryHead: QueryHead.QueryHead;
    private readonly queryLatest: QueryLatest;

    constructor(queryHead: QueryHead.QueryHead, queryLatest: QueryLatest) {
        this.state = new Map();
        this.queryHead = queryHead;
        this.queryLatest = queryLatest;
    }

    private pipeline(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
    ): RXJS.Observable<Uint8Array | undefined> {
        return RXJS.combineLatest(
            QueryHead.queryHeadObservable(this.queryHead, system),
            queryLatestObservable(this.queryLatest, system, contentType),
        ).pipe(
            RXJS.switchMap(([head, latest]) =>
                RXJS.of(computeCRDTValue(head, latest, contentType)),
            ),
        );
    }

    public query(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
        callback: SuccessCallback,
    ): UnregisterCallback {
        const systemString = Models.PublicKey.toString(system);

        const stateForSystem: StateForSystem = Util.lookupWithInitial(
            this.state,
            systemString,
            () => {
                return {
                    state: new Map(),
                };
            },
        );

        const contentTypeString = Models.ContentType.toString(contentType);

        let initial = false;

        const stateForCRDT: StateForCRDT = Util.lookupWithInitial(
            stateForSystem.state,
            contentTypeString,
            () => {
                initial = true;

                const value = new Box<Uint8Array | undefined>(undefined);
                const fulfilled = new Box<boolean>(true);
                const callbacks = new Set([callback]);

                const subscription = this.pipeline(
                    system,
                    contentType,
                ).subscribe((updatedValue) => {
                    value.value = updatedValue;
                    fulfilled.value = true;
                    callbacks.forEach((cb) => cb(value.value));
                });

                return {
                    value: value,
                    callbacks: callbacks,
                    fulfilled: fulfilled,
                    unsubscribe: subscription.unsubscribe.bind(subscription),
                };
            },
        );

        if (!initial) {
            if (stateForCRDT.callbacks.has(callback)) {
                throw DuplicatedCallbackError;
            }

            stateForCRDT.callbacks.add(callback);

            if (stateForCRDT.fulfilled.value) {
                callback(stateForCRDT.value.value);
            }
        }

        return () => {
            stateForCRDT.callbacks.delete(callback);

            if (stateForCRDT.callbacks.size === 0) {
                stateForCRDT.unsubscribe();

                stateForSystem.state.delete(contentTypeString);

                if (stateForSystem.state.size === 0) {
                    this.state.delete(systemString);
                }
            }
        };
    }
}

export function queryCRDTObservable(
    queryManager: QueryCRDT,
    system: Models.PublicKey.PublicKey,
    contentType: Models.ContentType.ContentType,
): RXJS.Observable<Uint8Array | undefined> {
    return new RXJS.Observable((subscriber) => {
        return queryManager.query(system, contentType, (value) => {
            subscriber.next(value);
        });
    });
}
