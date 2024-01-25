import Long from 'long';
import * as RXJS from 'rxjs';

import { QueryEvent, queryEventObservable } from './query-event2';
import { HasUpdate } from './has-update';
import { UnregisterCallback, DuplicatedCallbackError } from './shared';
import * as Ranges from '../ranges';
import * as Models from '../models';
import * as Util from '../util';

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
    fulfilled: boolean;
    unsubscribe: () => void;
};

export class QueryBlob extends HasUpdate {
    private readonly queryEvent: QueryEvent;
    private readonly state: Map<StateKey, StateForQuery>;

    constructor(queryEvent: QueryEvent) {
        super();

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
                    fulfilled: false,
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
                        Long.UZERO,
                    ),
                ),
            ).subscribe((signedEvents) => {
                stateForQuery.fulfilled = true;

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

            if (stateForQuery.fulfilled) {
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

    public update(signedEvent: Models.SignedEvent.SignedEvent): void {}
}
