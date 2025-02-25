import * as RXJS from 'rxjs';

import * as ProcessHandle from '../process-handle';
import * as Models from '../models';
import * as QueryIndex from './query-index';
import * as QueryCRDTSet from './query-crdt-set';
import { UnregisterCallback, DuplicatedCallbackError } from './shared';
import * as Util from '../util';
import { Box, OnceFlag } from '../util';

export type Callback = (servers: ReadonlySet<string>) => void;

interface StateForSystem {
    readonly servers: Box<Set<string>>;
    readonly queryHandle: QueryCRDTSet.QueryHandle;
    readonly callbacks: Set<Callback>;
    readonly fulfilled: OnceFlag;
}

export class QueryServers {
    private readonly processHandle: ProcessHandle.ProcessHandle;
    private readonly state: Map<
        Models.PublicKey.PublicKeyString,
        StateForSystem
    >;

    constructor(processHandle: ProcessHandle.ProcessHandle) {
        this.processHandle = processHandle;
        this.state = new Map();
    }

    public get clean(): boolean {
        return this.state.size === 0;
    }

    private queryStateToServers(
        queryState: readonly QueryIndex.Cell[],
    ): Set<string> {
        const result = new Set<string>();

        for (const cell of queryState) {
            if (cell.signedEvent === undefined) {
                continue;
            }

            const event = Models.Event.fromBuffer(cell.signedEvent.event);

            if (
                event.contentType.notEquals(
                    Models.ContentType.ContentTypeServer,
                )
            ) {
                throw new Error('impossible');
            }

            if (event.lwwElementSet === undefined) {
                throw new Error('impossible');
            }

            result.add(Util.decodeText(event.lwwElementSet.value));
        }

        return result;
    }

    public query(
        system: Models.PublicKey.PublicKey,
        callback: Callback,
    ): UnregisterCallback {
        const systemString = Models.PublicKey.toString(system);

        let initial = false;

        const stateForSystem: StateForSystem = Util.lookupWithInitial(
            this.state,
            systemString,
            () => {
                initial = true;

                const queryState = new Box<QueryIndex.Cell[]>([]);
                const callbacks = new Set([callback]);
                const fulfilled = new OnceFlag();
                const servers = new Box<Set<string>>(
                    this.processHandle.getAddressHints(system),
                );

                if (servers.value.size !== 0) {
                    fulfilled.set();
                    callback(servers.value);
                }

                const queryHandle =
                    this.processHandle.queryManager.queryCRDTSet.query(
                        this.processHandle.system(),
                        Models.ContentType.ContentTypeServer,
                        (patch) => {
                            fulfilled.set();

                            queryState.value = QueryIndex.applyPatch(
                                queryState.value,
                                patch,
                            );

                            servers.value = new Set([
                                ...this.queryStateToServers(queryState.value),
                                ...this.processHandle.getAddressHints(system),
                            ]);

                            callbacks.forEach((cb) => {
                                cb(servers.value);
                            });

                            queryHandle.advance(10);
                        },
                    );

                queryHandle.advance(10);

                return {
                    servers: servers,
                    queryHandle: queryHandle,
                    callbacks: callbacks,
                    fulfilled: fulfilled,
                };
            },
        );

        /* eslint @typescript-eslint/no-unnecessary-condition: 0 */
        if (!initial) {
            if (stateForSystem.callbacks.has(callback)) {
                throw DuplicatedCallbackError;
            }

            stateForSystem.callbacks.add(callback);

            if (stateForSystem.fulfilled.value) {
                callback(stateForSystem.servers.value);
            }
        }

        return () => {
            stateForSystem.callbacks.delete(callback);

            if (stateForSystem.callbacks.size === 0) {
                stateForSystem.queryHandle.unregister();

                this.state.delete(systemString);
            }
        };
    }
}

export function queryServersObservable(
    queryManager: QueryServers,
    system: Models.PublicKey.PublicKey,
): RXJS.Observable<ReadonlySet<string>> {
    return new RXJS.Observable((subscriber) => {
        return queryManager.query(system, (servers) => {
            subscriber.next(servers);
        });
    });
}
