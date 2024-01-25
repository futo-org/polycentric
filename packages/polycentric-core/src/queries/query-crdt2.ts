import Long from 'long';

import * as Models from '../models';
import * as Util from '../util';
import { HasUpdate } from './has-update';
import * as QueryHead from './query-head2';
import { QueryEvent } from './query-event2';
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

export class QueryCRDT extends HasUpdate {
    private readonly state: Map<
        Models.PublicKey.PublicKeyString,
        StateForSystem
    >;
    private readonly queryHead: QueryHead.QueryHead;
    private readonly queryEvent: QueryEvent;

    constructor(
        queryHead: QueryHead.QueryHead,
        queryEvent: QueryEvent,
    ) {
        super();

        this.state = new Map();
        this.queryHead = queryHead;
        this.queryEvent = queryEvent;
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

        return () => {
        };
    }

    public update(signedEvent: Models.SignedEvent.SignedEvent): void {}
}
