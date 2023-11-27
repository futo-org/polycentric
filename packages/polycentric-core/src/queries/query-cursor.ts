import * as APIMethods from '../api-methods';
import * as Models from '../models';
import * as ProcessHandle from '../process-handle';

export function makeGetExploreCallback(): LoadCallback {
    return APIMethods.getExplore;
}

export function makeGetSearchCallback(searchQuery: string): LoadCallback {
    return async (server, limit, cursor) => {
        return await APIMethods.getSearch(server, searchQuery, limit, cursor);
    };
}

export type LoadCallback = (
    server: string,
    limit: number,
    cursor: Uint8Array | undefined,
) => Promise<Models.ResultEventsAndRelatedEventsAndCursor.Type>;

export type Cell = {
    fromServer: string;
    signedEvent: Models.SignedEvent.SignedEvent;
};

export type ResultCallback = (cells: Array<Cell>) => void;

export class Query {
    private _processHandle: ProcessHandle.ProcessHandle;
    private _loadCallback: LoadCallback;
    private _cursors: Map<string, Uint8Array>;
    private _active: Set<string>;
    private _loaded: Set<Models.Pointer.PointerString>;
    private _expected: number;
    private _cancelled: boolean;
    private _reserve: Array<Cell>;
    private _resultCallback: ResultCallback;
    private _batchSize: number;

    constructor(
        processHandle: ProcessHandle.ProcessHandle,
        loadCallback: LoadCallback,
        resultCallback: ResultCallback,
        batchSize: number,
    ) {
        this._processHandle = processHandle;
        this._loadCallback = loadCallback;
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

    private async _drainReserve(): Promise<void> {
        const batch = [];

        while (batch.length < this._expected) {
            const cell = this._reserve.shift();

            if (cell === undefined) {
                break;
            }

            const pointerString = Models.Pointer.toString(
                await Models.signedEventToPointer(cell.signedEvent),
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

                await this._drainReserve();

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

        for (const server of state.servers()) {
            this._loadFromServer(server, limitPerServer);
        }
    }

    private async _advanceInternal(): Promise<void> {
        await this._drainReserve();
        await this._loadFromServers();
    }

    public advance(): void {
        this._expected += this._batchSize;
        this._advanceInternal();
    }

    public cleanup(): void {
        this._cancelled = true;
    }
}
