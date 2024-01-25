import Long from 'long';
import * as RXJS from 'rxjs';

import * as Models from '../models';
import * as Util from '../util';
import * as Protocol from '../protocol';
import { HasUpdate } from './has-update';
import * as QueryHead from './query-head2';
import { QueryEvent, queryEventObservable } from './query-event2';
import { UnregisterCallback, DuplicatedCallbackError } from './shared';

export type SuccessCallback = (value: Uint8Array) => void;

type StateForCRDT = {
    value: Uint8Array;
    unixMilliseconds: Long;
    readonly callbacks: Set<SuccessCallback>;
    fulfilled: boolean;
};

type StateForSystem = {
    readonly state: Map<Models.ContentType.ContentTypeString, StateForCRDT>;
};

function mapToArray<Key, ValueT1, ValueT2>(
    map: ReadonlyMap<Key, ValueT1>,
    operation: (value: ValueT1) => ValueT2,
): Array<ValueT2> {
    const result: Array<ValueT2> = [];
    map.forEach((value) => result.push(operation(value)));
    return result;
}

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

function extractCRDTValue(
    signedEvents: Array<Models.SignedEvent.SignedEvent | undefined>,
    contentType: Models.ContentType.ContentType,
): RXJS.Observable<Uint8Array | undefined> {
    const events = signedEvents
        .filter((signedEvent) => signedEvent !== undefined)
        .map((signedEvent) => Models.Event.fromBuffer(signedEvent!.event))
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

    if (result) {
        return RXJS.of(result);
    } else {
        return RXJS.of(undefined);
    }
}

export class QueryCRDT extends HasUpdate {
    private readonly state: Map<
        Models.PublicKey.PublicKeyString,
        StateForSystem
    >;
    private readonly queryHead: QueryHead.QueryHead;
    private readonly queryEvent: QueryEvent;

    constructor(queryHead: QueryHead.QueryHead, queryEvent: QueryEvent) {
        super();

        this.state = new Map();
        this.queryHead = queryHead;
        this.queryEvent = queryEvent;
    }

    private run(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
    ): void {
        const observable = QueryHead.queryHeadObservable(
            this.queryHead,
            system,
        ).pipe(
            RXJS.switchMap((head) =>
                RXJS.combineLatest(
                    mapToArray(head, (signedEvent) => {
                        const event = Models.Event.fromBuffer(
                            signedEvent.event,
                        );

                        if (event.contentType.equals(contentType)) {
                            return RXJS.of(signedEvent);
                        }

                        const next = lookupIndex(event.indices, contentType);

                        if (!next) {
                            return RXJS.of(undefined);
                        }

                        return queryEventObservable(
                            this.queryEvent,
                            event.system,
                            event.process,
                            next,
                        );
                    }),
                ).pipe(
                    RXJS.switchMap((signedEvents) =>
                        extractCRDTValue(signedEvents, contentType),
                    ),
                ),
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

        const stateForCRDT: StateForCRDT = Util.lookupWithInitial(
            stateForSystem.state,
            contentTypeString,
            () => {
                return {
                    value: new Uint8Array(),
                    unixMilliseconds: Long.UZERO,
                    callbacks: new Set(),
                    fulfilled: false,
                };
            },
        );

        if (stateForCRDT.callbacks.has(callback)) {
            throw DuplicatedCallbackError;
        }

        stateForCRDT.callbacks.add(callback);

        if (stateForCRDT.fulfilled) {
            callback(stateForCRDT.value);
        }

        return () => {};
    }

    public update(signedEvent: Models.SignedEvent.SignedEvent): void {}
}
