import Long from 'long';

import * as ProcessHandle from '../process-handle';
import * as APIMethods from '../api-methods';
import * as Models from '../models';
import * as Util from '../util';
import * as Protocol from '../protocol';
import * as Shared from './shared';

export type Cell = {
    unixMilliseconds: Long;
    process: Models.Process.Process;
    logicalClock: Long;
    contentType: Models.ContentType.ContentType;
    next: Long | undefined;
    signedEvent: Models.SignedEvent.SignedEvent | undefined;
};

export function compareCells(a: Cell, b: Cell): number {
    const timeComparison = a.unixMilliseconds.compare(b.unixMilliseconds);

    if (timeComparison !== 0) {
        return timeComparison;
    }

    const processComparison = Util.compareBuffers(
        a.process.process,
        b.process.process,
    );

    if (processComparison !== 0) {
        return processComparison;
    }

    const clockComparison = a.logicalClock.compare(b.logicalClock);

    return clockComparison;
}

function signedEventToCell(signedEvent: Models.SignedEvent.SignedEvent): Cell {
    const event = Models.Event.fromBuffer(signedEvent.event);

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

    if (event.contentType.equals(Models.ContentType.ContentTypeDelete)) {
        const content = Models.Delete.fromBuffer(event.content);

        return {
            unixMilliseconds: content.unixMilliseconds!,
            process: content.process,
            logicalClock: content.logicalClock,
            contentType: content.contentType,
            next: lookupIndex(content.indices, content.contentType),
            signedEvent: signedEvent,
        };
    } else {
        return {
            unixMilliseconds: event.unixMilliseconds!,
            process: event.process,
            logicalClock: event.logicalClock,
            contentType: event.contentType,
            next: lookupIndex(event.indices, event.contentType),
            signedEvent: signedEvent,
        };
    }
}

function rawEventToCell(rawEvent: Protocol.SignedEvent): Cell {
    return signedEventToCell(Models.SignedEvent.fromProto(rawEvent));
}

export type CallbackParameters = {
    add: Array<Cell>;
    remove: Array<Cell>;
};

type Callback = (state: CallbackParameters) => void;

function processAndLogicalClockToString(
    process: Models.Process.Process,
    logicalClock: Long,
): string {
    return Models.Process.toString(process) + logicalClock.toString();
}

type StateForQuery = {
    callback: Callback;
    totalExpected: number;
    contentType: Models.ContentType.ContentType;
    earliestTimeBySource: Map<String, Long>;
    eventsByProcessAndLogicalClock: Map<String, Cell>;
    eventsByTime: Array<Cell>;
    missingProcessAndLogicalClock: Map<String, Cell>;
};

type StateForSystem = {
    queries: Map<Callback, StateForQuery>;
};

export class QueryManager {
    private _processHandle: ProcessHandle.ProcessHandle;
    private _state: Map<Models.PublicKey.PublicKeyString, StateForSystem>;
    private _useDisk: boolean;
    private _useNetwork: boolean;

    constructor(processHandle: ProcessHandle.ProcessHandle) {
        this._processHandle = processHandle;
        this._state = new Map();
        this._useDisk = true;
        this._useNetwork = true;
    }

    public useDisk(useDisk: boolean): void {
        this._useDisk = useDisk;
    }

    public useNetwork(useNetwork: boolean): void {
        this._useNetwork = useNetwork;
    }

    public query(
        system: Models.PublicKey.PublicKey,
        contentType: Models.ContentType.ContentType,
        callback: Callback,
    ): Shared.UnregisterCallback {
        const systemString = Models.PublicKey.toString(system);

        let stateForSystem = this._state.get(systemString);

        if (stateForSystem === undefined) {
            stateForSystem = {
                queries: new Map(),
            };

            this._state.set(systemString, stateForSystem);
        }

        const stateForQuery = {
            callback: callback,
            totalExpected: 0,
            contentType: contentType,
            earliestTimeBySource: new Map(),
            eventsByProcessAndLogicalClock: new Map(),
            eventsByTime: [],
            missingProcessAndLogicalClock: new Map(),
        };

        stateForSystem.queries.set(callback, stateForQuery);

        return () => {
            if (stateForSystem !== undefined) {
                stateForSystem.queries.delete(callback);
            } else {
                throw Error('impossible');
            }
        };
    }

    public advance(
        system: Models.PublicKey.PublicKey,
        callback: Callback,
        additionalCount: number,
    ): void {
        const systemString = Models.PublicKey.toString(system);

        let stateForSystem = this._state.get(systemString);

        if (stateForSystem === undefined) {
            return;
        }

        const stateForQuery = stateForSystem.queries.get(callback);

        if (stateForQuery === undefined) {
            return;
        }

        if (
            stateForQuery.totalExpected - stateForQuery.eventsByTime.length >
            0
        ) {
            return;
        }

        stateForQuery.totalExpected += additionalCount;

        if (this._useNetwork === true) {
            this.loadFromNetwork(system, stateForQuery);
        }

        if (this._useDisk === true) {
            this.loadFromDisk(system, stateForQuery);
        }
    }

    private async loadFromDisk(
        system: Models.PublicKey.PublicKey,
        stateForQuery: StateForQuery,
    ): Promise<void> {
        const events = await this._processHandle
            .store()
            .queryIndexSystemContentTypeUnixMillisecondsProcess(
                system,
                stateForQuery.contentType,
                stateForQuery.earliestTimeBySource.get('disk'),
                stateForQuery.totalExpected - stateForQuery.eventsByTime.length,
            );

        this.updateQueryBatch(
            events.map(rawEventToCell),
            [],
            'disk',
            stateForQuery,
        );
    }

    private async loadFromNetwork(
        system: Models.PublicKey.PublicKey,
        stateForQuery: StateForQuery,
    ): Promise<void> {
        const systemState = await this._processHandle.loadSystemState(system);

        for (const server of systemState.servers()) {
            try {
                this.loadFromNetworkSpecific(system, server, stateForQuery);
            } catch (err) {
                console.log(err);
            }
        }
    }

    private async loadFromNetworkSpecific(
        system: Models.PublicKey.PublicKey,
        server: string,
        stateForQuery: StateForQuery,
    ): Promise<void> {
        const response = await APIMethods.getQueryIndex(
            server,
            system,
            Models.ContentType.ContentTypeClaim,
            stateForQuery.earliestTimeBySource.get(server),
            Long.fromNumber(
                stateForQuery.totalExpected - stateForQuery.eventsByTime.length,
            ),
        );

        this.updateQueryBatch(
            response.events.map(rawEventToCell),
            response.proof.map(rawEventToCell),
            server,
            stateForQuery,
        );
    }

    public update(signedEvent: Models.SignedEvent.SignedEvent): void {
        const event = Models.Event.fromBuffer(signedEvent.event);

        const systemString = Models.PublicKey.toString(event.system);

        let stateForSystem = this._state.get(systemString);

        if (stateForSystem === undefined) {
            return;
        }

        for (const stateForQuery of stateForSystem.queries.values()) {
            this.updateQueryBatch(
                [rawEventToCell(signedEvent)],
                [],
                'unknown',
                stateForQuery,
            );
        }
    }

    private validateBatchIsRelevant(
        events: Array<Cell>,
        contentType: Models.ContentType.ContentType,
    ): boolean {
        return events.every((cell) => cell.contentType.equals(contentType));
    }

    private validateBatchIsSorted(events: Array<Cell>): boolean {
        for (let i = 0; i < events.length - 1; i++) {
            if (compareCells(events[i], events[i + 1]) !== 1) {
                return false;
            }
        }

        return true;
    }

    private validateIntegrity(stateForQuery: StateForQuery): Array<Cell> {
        const eventsByTime = stateForQuery.eventsByTime;

        const missingAfter = [];

        for (let i = 0; i < eventsByTime.length; i++) {
            const currentEvent = eventsByTime[i];

            // last event of type from process
            if (currentEvent.next === undefined) {
                continue;
            }

            if (i + 1 >= eventsByTime.length) {
                missingAfter.push(currentEvent);
                continue;
            }

            const nextEventByTime = eventsByTime[i + 1];

            if (
                Models.Process.equal(
                    nextEventByTime.process,
                    currentEvent.process,
                )
            ) {
                if (nextEventByTime.logicalClock.equals(currentEvent.next)) {
                    continue;
                } else {
                    missingAfter.push(currentEvent);
                    continue;
                }
            } else {
                const nextEventByClock =
                    stateForQuery.eventsByProcessAndLogicalClock.get(
                        processAndLogicalClockToString(
                            currentEvent.process,
                            currentEvent.logicalClock.subtract(Long.UONE),
                        ),
                    );

                if (nextEventByClock === undefined) {
                    missingAfter.push(currentEvent);
                    continue;
                }

                if (
                    nextEventByClock.unixMilliseconds.greaterThanOrEqual(
                        nextEventByTime.unixMilliseconds!,
                    )
                ) {
                    missingAfter.push(currentEvent);
                    continue;
                }
            }
        }

        let missingSlots = [];

        for (const missing of missingAfter) {
            const placeholder = {
                unixMilliseconds: missing.unixMilliseconds,
                process: missing.process,
                logicalClock: missing.logicalClock.subtract(Long.UONE),
                contentType: stateForQuery.contentType,
                next: undefined,
                signedEvent: undefined,
            };

            const key = processAndLogicalClockToString(
                placeholder.process,
                placeholder.logicalClock,
            );

            if (!stateForQuery.missingProcessAndLogicalClock.has(key)) {
                stateForQuery.missingProcessAndLogicalClock.set(
                    key,
                    placeholder,
                );

                missingSlots.push(placeholder);
            }
        }

        return missingSlots;
    }

    private updateQueryBatch(
        cells: Array<Cell>,
        proofCells: Array<Cell>,
        source: string,
        stateForQuery: StateForQuery,
    ): void {
        const allCells = cells.concat(proofCells);

        if (!this.validateBatchIsRelevant(cells, stateForQuery.contentType)) {
            return;
        }

        if (!this.validateBatchIsSorted(cells)) {
            console.warn('batch failed sort validation');

            return;
        }

        let earliestTime = stateForQuery.earliestTimeBySource.get(source);

        let cellsToAdd = [];
        let cellsToRemove = [];

        for (const cell of cells) {
            const key = processAndLogicalClockToString(
                cell.process,
                cell.logicalClock,
            );

            if (!stateForQuery.eventsByProcessAndLogicalClock.has(key)) {
                stateForQuery.eventsByTime.push(cell);

                cellsToAdd.push(cell);

                const placeholder =
                    stateForQuery.missingProcessAndLogicalClock.get(key);

                if (placeholder !== undefined) {
                    stateForQuery.missingProcessAndLogicalClock.delete(key);

                    cellsToRemove.push(placeholder);
                }
            }

            if (
                earliestTime === undefined ||
                earliestTime.greaterThan(cell.unixMilliseconds)
            ) {
                earliestTime = cell.unixMilliseconds;
            }
        }

        stateForQuery.earliestTimeBySource.set(source, earliestTime!);

        for (const cell of allCells) {
            stateForQuery.eventsByProcessAndLogicalClock.set(
                processAndLogicalClockToString(cell.process, cell.logicalClock),
                cell,
            );
        }

        stateForQuery.eventsByTime.sort(compareCells).reverse();

        const addMissingAfter = this.validateIntegrity(stateForQuery);

        stateForQuery.callback({
            add: cellsToAdd
                .concat(addMissingAfter)
                .sort(compareCells)
                .reverse(),
            remove: cellsToRemove,
        });
    }
}
