import { QueryHead } from './query-head2';
import * as Models from '../models';
import { UnregisterCallback, DuplicatedCallbackError } from './shared';
import * as Util from '../util';

export type Callback = (
    values: ReadonlyMap<
        Models.Process.ProcessString,
        Models.SignedEvent.SignedEvent
    >,
) => void;

type StateForContentType = {
    fulfilled: boolean;
    readonly values: Map<
        Models.Process.ProcessString,
        Models.SignedEvent.SignedEvent
    >;
    readonly callbacks: Set<Callback>;
};

type StateForSystem = {
    readonly stateForContentType: Map<
        Models.ContentType.ContentTypeString,
        StateForContentType
    >;
};

export class QueryLatest {
    private readonly state: Map<
        Models.PublicKey.PublicKeyString,
        StateForSystem
    >;

    private readonly queryHead: QueryHead;

    constructor(queryHead: QueryHead) {
        this.state = new Map();
        this.queryHead = queryHead;
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
                    fulfilled: false,
                    values: new Map(),
                    callbacks: new Set([callback]),
                };
            },
        );

        if (!initial) {
            if (stateForContentType.callbacks.has(callback)) {
                throw DuplicatedCallbackError;
            }

            stateForContentType.callbacks.add(callback);

            if (stateForContentType.fulfilled) {
                callback(stateForContentType.values);
            }
        }

        return () => {
            stateForContentType.callbacks.delete(callback);

            if (stateForContentType.callbacks.size === 0) {
                stateForSystem.stateForContentType.delete(contentTypeString);

                if (stateForSystem.stateForContentType.size === 0) {
                    this.state.delete(systemString);
                }
            }
        };
    }
}
