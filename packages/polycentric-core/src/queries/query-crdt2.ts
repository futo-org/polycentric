import Long from 'long';
import * as RXJS from 'rxjs';

import * as Models from '../models';
import * as Util from '../util';
import * as Protocol from '../protocol';
import * as QueryHead from './query-head2';
import { UnregisterCallback, DuplicatedCallbackError } from './shared';
import { Box, OnceFlag } from '../util';
import { QueryLatest, queryLatestObservable } from './query-latest';

export type CallbackValue = {
    readonly missingData: boolean;
    readonly value: Uint8Array | undefined;
};

function callbackValuesEqual(a: CallbackValue, b: CallbackValue): boolean {
    if (a.missingData !== b.missingData) {
        return false;
    }

    if (a.value && b.value && !Util.buffersEqual(a.value, b.value)) {
        return false;
    }

    if (!!a.value !== !!b.value) {
        return false;
    }

    return true;
}

export type SuccessCallback = (value: CallbackValue) => void;

type StateForCRDT = {
    readonly value: Box<CallbackValue>;
    readonly callbacks: Set<SuccessCallback>;
    readonly fulfilled: OnceFlag;
    readonly unsubscribe: () => void;
};

type StateForSystem = {
    readonly state: Map<Models.ContentType.ContentTypeString, StateForCRDT>;
};

function computeCRDTValue(
    head: QueryHead.CallbackValue,
    latestEvents: ReadonlyMap<
        Models.Process.ProcessString,
        Models.SignedEvent.SignedEvent
    >,
    contentType: Models.ContentType.ContentType,
): CallbackValue {
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
    let missingData = false;

    for (const event of events) {
        const headSignedEvent = head.head.get(
            Models.Process.toString(event.process),
        );

        if (headSignedEvent) {
            const headEvent = Models.Event.fromBuffer(headSignedEvent.event);

            if (headEvent.contentType.notEquals(contentType)) {
                const index = Models.Event.lookupIndex(headEvent, contentType);

                if (index && index.notEquals(event.logicalClock)) {
                    missingData = true;
                }
            }
        }

        if (event.unixMilliseconds && event.lwwElement) {
            if (event.unixMilliseconds.greaterThanOrEqual(latestTime)) {
                latestTime = event.unixMilliseconds;
                result = event.lwwElement.value;
            }
        }
    }

    return {
        missingData: missingData || head.missingData,
        value: result,
    };
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

    public get clean(): boolean {
        return this.state.size === 0;
    }

    private pipeline(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
    ): RXJS.Observable<CallbackValue> {
        return RXJS.combineLatest(
            QueryHead.queryHeadObservable(this.queryHead, system),
            queryLatestObservable(this.queryLatest, system, contentType),
        ).pipe(
            RXJS.switchMap(([head, latest]) =>
                RXJS.of(computeCRDTValue(head, latest, contentType)),
            ),
            RXJS.distinctUntilChanged(callbackValuesEqual),
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

                const value = new Box<CallbackValue>({
                    missingData: true,
                    value: undefined,
                });

                const fulfilled = new OnceFlag();
                const callbacks = new Set([callback]);

                const subscription = this.pipeline(
                    system,
                    contentType,
                ).subscribe((updatedValue) => {
                    value.value = updatedValue;
                    fulfilled.set();
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
): RXJS.Observable<CallbackValue> {
    return new RXJS.Observable((subscriber) => {
        return queryManager.query(system, contentType, (value) => {
            subscriber.next(value);
        });
    });
}
