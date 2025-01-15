import * as APIMethods from '../api-methods';
import * as Models from '../models';
import * as Protocol from '../protocol';
import * as ProcessHandle from '../process-handle';

export function makeGetExploreCallback(
    processHandle: ProcessHandle.ProcessHandle,
): LoadCallback {
    return async (server, limit, cursor) => {
        const batch = await APIMethods.getExplore(server, limit, cursor);

        const filteredResultEvents = [];

        for (const signedEvent of batch.resultEvents.events) {
            const event = Models.Event.fromBuffer(signedEvent.event);

            const blocked = await processHandle
                .store()
                .indexCRDTElementSet.queryIfAdded(
                    processHandle.system(),
                    Models.ContentType.ContentTypeBlock,
                    Protocol.PublicKey.encode(event.system).finish(),
                );

            if (!blocked) {
                filteredResultEvents.push(signedEvent);
            }
        }

        return Models.ResultEventsAndRelatedEventsAndCursor.fromProto({
            resultEvents: {
                events: filteredResultEvents,
            },
            relatedEvents: batch.relatedEvents,
            cursor: batch.cursor,
        });
    };
}

export function makeGetSearchCallback(
    searchQuery: string,
    searchType: APIMethods.SearchType,
): LoadCallback {
    return async (server, limit, cursor) => {
        return await APIMethods.getSearch(
            server,
            searchQuery,
            limit,
            cursor,
            searchType,
        );
    };
}

export type LoadCallback = (
    server: string,
    limit: number,
    cursor: Uint8Array | undefined,
) => Promise<Models.ResultEventsAndRelatedEventsAndCursor.Type>;

type NothingFoundCallback = () => void;

export interface Cell {
    readonly fromServer: string;
    readonly signedEvent: Models.SignedEvent.SignedEvent;
}

export type ResultCallback = (cells: readonly Cell[]) => void;

export class Query {
    private readonly _processHandle: ProcessHandle.ProcessHandle;
    private readonly _loadCallback: LoadCallback;
    private readonly _nothingFoundCallback?: NothingFoundCallback;
    private readonly _cursors: Map<string, Uint8Array>;
    private readonly _active: Set<string>;
    private readonly _loaded: Set<Models.Pointer.PointerString>;
    private _expected: number;
    private _cancelled: boolean;
    private readonly _reserve: Cell[];
    private readonly _resultCallback: ResultCallback;
    private readonly _batchSize: number;

    constructor(
        processHandle: ProcessHandle.ProcessHandle,
        loadCallback: LoadCallback,
        resultCallback: ResultCallback,
        batchSize: number,
        nothingFoundCallback?: () => void,
    ) {
        this._processHandle = processHandle;
        this._loadCallback = loadCallback;
        this._nothingFoundCallback = nothingFoundCallback;
        this._cursors = new Map();
        this._active = new Set();
        this._loaded = new Set();
        this._expected = 0;
        this._cancelled = false;
        this._reserve = [];
        this._resultCallback = resultCallback;
        this._batchSize = batchSize;

        if (!Number.isInteger(batchSize) || batchSize === 0) {
            throw new Error('invalid batch size');
        }
    }

    private _drainReserve(): void {
        const batch = [];

        while (batch.length < this._expected) {
            const cell = this._reserve.shift();

            if (cell === undefined) {
                break;
            }

            const pointerString = Models.Pointer.toString(
                Models.signedEventToPointer(cell.signedEvent),
            );

            if (this._loaded.has(pointerString)) {
                continue;
            }

            this._loaded.add(pointerString);

            batch.push(cell);
        }

        if (batch.length > 0) {
            this._resultCallback(batch);
        }
    }

    private async _loadFromServer(
        server: string,
        limit: number,
    ): Promise<void> {
        if (this._active.has(server)) {
            return;
        }

        this._active.add(server);

        try {
            while (this._loaded.size < this._expected) {
                const result = await this._loadCallback(
                    server,
                    limit,
                    this._cursors.get(server),
                );

                if (
                    this._cancelled ||
                    (result.relatedEvents.events.length === 0 &&
                        result.resultEvents.events.length === 0)
                ) {
                    break;
                }

                for (const signedEvent of result.relatedEvents.events) {
                    await this._processHandle.ingest(signedEvent);
                }

                for (const signedEvent of result.resultEvents.events) {
                    await this._processHandle.ingest(signedEvent);
                }

                this._reserve.push(
                    ...result.resultEvents.events.map((signedEvent) => {
                        return {
                            fromServer: server,
                            signedEvent: signedEvent,
                        };
                    }),
                );

                if (result.cursor) {
                    this._cursors.set(server, result.cursor);
                }

                this._drainReserve();

                if (result.cursor === undefined) {
                    // This means the number of rows returned was less than the limit,
                    // so we can stop querying this server.
                    break;
                }
            }
        } catch (err) {
            console.error(err);
        }

        this._active.delete(server);
    }

    private async _loadFromServers(): Promise<void> {
        const state = await this._processHandle.loadSystemState(
            this._processHandle.system(),
        );

        if (state.servers().length === 0) {
            return;
        }

        const limitPerServer = Math.ceil(
            this._batchSize / state.servers().length,
        );

        await Promise.allSettled(
            state
                .servers()
                .map((server) => this._loadFromServer(server, limitPerServer)),
        );
    }

    private async _advanceInternal(): Promise<void> {
        this._drainReserve();
        await this._loadFromServers();

        if (this._loaded.size === 0) {
            this._nothingFoundCallback?.();
        }
    }

    public advance(): void {
        this._expected += this._batchSize;
        void this._advanceInternal();
    }

    public cleanup(): void {
        this._cancelled = true;
    }
}
