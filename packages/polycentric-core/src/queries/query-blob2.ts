import * as RXJS from 'rxjs';

import { QueryEvent, queryEventObservable } from './query-event2';
import { UnregisterCallback, DuplicatedCallbackError } from './shared';
import * as Ranges from '../ranges';
import * as Models from '../models';
import * as Util from '../util';
import { OnceFlag } from '../util';

export type StateKey = Readonly<string> & {
    readonly __tag: unique symbol;
};

function makeStateKey(
    system: Models.PublicKey.PublicKey,
    process: Models.Process.Process,
    ranges: ReadonlyArray<Ranges.IRange>,
): StateKey {
    return (Models.PublicKey.toString(system) +
        Models.Process.toString(process) +
        Ranges.toString(ranges)) as StateKey;
}

export type Callback = (buffer: Uint8Array | undefined) => void;

type StateForQuery = {
    value: Uint8Array | undefined;
    readonly callbacks: Set<Callback>;
    readonly fulfilled: OnceFlag;
    unsubscribe: () => void;
};

export class QueryBlob {
    private readonly queryEvent: QueryEvent;
    private readonly state: Map<StateKey, StateForQuery>;

    constructor(queryEvent: QueryEvent) {
        this.queryEvent = queryEvent;
        this.state = new Map();
    }

    public query(
        system: Models.PublicKey.PublicKey,
        process: Models.Process.Process,
        ranges: ReadonlyArray<Ranges.IRange>,
        callback: Callback,
    ): UnregisterCallback {
        const stateKey = makeStateKey(system, process, ranges);

        const stateForQuery: StateForQuery = Util.lookupWithInitial(
            this.state,
            stateKey,
            () => {
                return {
                    value: undefined,
                    callbacks: new Set(),
                    unsubscribe: () => {},
                    fulfilled: new OnceFlag(),
                };
            },
        );

        if (stateForQuery.callbacks.has(callback)) {
            throw DuplicatedCallbackError;
        }

        if (stateForQuery.callbacks.size === 0) {
            stateForQuery.callbacks.add(callback);

            const subscription = RXJS.combineLatest(
                Ranges.toArray(ranges).map((logicalClock) =>
                    queryEventObservable(
                        this.queryEvent,
                        system,
                        process,
                        logicalClock,
                    ),
                ),
            ).subscribe((signedEvents) => {
                stateForQuery.fulfilled.set();

                const events = signedEvents.map((signedEvent) => {
                    return Models.Event.fromBuffer(signedEvent.event);
                });

                if (
                    events.some((event) =>
                        event.contentType.equals(
                            Models.ContentType.ContentTypeDelete,
                        ),
                    )
                ) {
                    stateForQuery.value = undefined;
                } else {
                    stateForQuery.value = Util.concatBuffers(
                        events
                            .sort((a, b) =>
                                a.logicalClock.compare(b.logicalClock),
                            )
                            .map((event) => event.content),
                    );
                }

                stateForQuery.callbacks.forEach((cb) =>
                    cb(stateForQuery.value),
                );
            });

            stateForQuery.unsubscribe = () => {
                subscription.unsubscribe();
            };
        } else {
            stateForQuery.callbacks.add(callback);

            if (stateForQuery.fulfilled.value) {
                callback(stateForQuery.value);
            }
        }

        return () => {
            stateForQuery.callbacks.delete(callback);

            if (stateForQuery.callbacks.size === 0) {
                stateForQuery.unsubscribe();

                this.state.delete(stateKey);
            }
        };
    }
}

export function queryBlobObservable(
    queryManager: QueryBlob,
    system: Models.PublicKey.PublicKey,
    process: Models.Process.Process,
    ranges: ReadonlyArray<Ranges.IRange>,
): RXJS.Observable<Uint8Array | undefined> {
    return new RXJS.Observable((subscriber) => {
        return queryManager.query(system, process, ranges, (value) => {
            subscriber.next(value);
        });
    });
}
