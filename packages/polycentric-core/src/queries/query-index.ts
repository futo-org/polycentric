import Long from 'long';

import * as APIMethods from '../api-methods';
import * as Models from '../models';
import * as ProcessHandle from '../process-handle';
import * as Protocol from '../protocol';
import * as Util from '../util';
import { HasUpdate } from './has-update';
import * as Shared from './shared';

export interface QueryHandle {
  advance(additionalCount: number): void;
  unregister(): void;
}

export interface Cell {
  readonly unixMilliseconds: Long;
  readonly process: Models.Process.Process;
  readonly logicalClock: Long;
  readonly contentType: Models.ContentType.ContentType;
  readonly next: Long | undefined;
  readonly signedEvent: Models.SignedEvent.SignedEvent | undefined;
  readonly key: string;
  readonly isDelete: boolean;
}

export function applyPatch(
  state: readonly Cell[],
  patch: CallbackParameters,
): Cell[] {
  return state
    .filter((x) => !patch.remove.has(x.key))
    .concat(patch.add)
    .sort(compareCells)
    .reverse();
}

export function compareCells(a: Readonly<Cell>, b: Readonly<Cell>): number {
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

    if (content.unixMilliseconds === undefined) {
      throw Error('content.unixMilliseconds');
    }

    return {
      unixMilliseconds: content.unixMilliseconds,
      process: content.process,
      logicalClock: content.logicalClock,
      contentType: content.contentType,
      next: lookupIndex(content.indices, content.contentType),
      signedEvent: signedEvent,
      key: processAndLogicalClockToString(
        content.process,
        content.logicalClock,
      ),
      isDelete: true,
    };
  } else {
    if (event.unixMilliseconds === undefined) {
      throw Error('event.unixMilliseconds');
    }

    return {
      unixMilliseconds: event.unixMilliseconds,
      process: event.process,
      logicalClock: event.logicalClock,
      contentType: event.contentType,
      next: lookupIndex(event.indices, event.contentType),
      signedEvent: signedEvent,
      key: processAndLogicalClockToString(event.process, event.logicalClock),
      isDelete: false,
    };
  }
}

export interface CallbackParameters {
  add: readonly Cell[];
  remove: ReadonlySet<string>;
}

export type Callback = (state: CallbackParameters) => void;
type AllSourcesAttemptedCallback = () => void;

function processAndLogicalClockToString(
  process: Models.Process.Process,
  logicalClock: Long,
): string {
  return Models.Process.toString(process) + logicalClock.toString();
}

interface StateForQuery {
  readonly callback: Callback;
  readonly allSourcesAttemptedCallback?: AllSourcesAttemptedCallback;
  totalExpected: number;
  readonly contentType: Models.ContentType.ContentType;
  readonly earliestTimeBySource: Map<string, Long>;
  readonly eventsByProcessAndLogicalClock: Map<string, Cell>;
  readonly eventsByTime: Cell[];
  readonly missingProcessAndLogicalClock: Map<string, Cell>;
}

interface StateForSystem {
  readonly queries: Map<Callback, StateForQuery>;
}

export class QueryManager implements HasUpdate {
  private readonly _processHandle: ProcessHandle.ProcessHandle;
  private readonly _state: Map<
    Models.PublicKey.PublicKeyString,
    StateForSystem
  >;
  private _useDisk: boolean;
  private _useNetwork: boolean;
  private onLoadedBatch?: Shared.OnLoadedBatch;

  constructor(
    processHandle: ProcessHandle.ProcessHandle,
    onLoadedBatch?: Shared.OnLoadedBatch,
  ) {
    this._processHandle = processHandle;
    this._state = new Map();
    this._useDisk = true;
    this._useNetwork = true;
    this.onLoadedBatch = onLoadedBatch;
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
    allSourcesAttemptedCallback?: AllSourcesAttemptedCallback,
  ): QueryHandle {
    const systemString = Models.PublicKey.toString(system);

    const stateForSystem: StateForSystem = Util.lookupWithInitial(
      this._state,
      systemString,
      () => {
        return {
          queries: new Map(),
        };
      },
    );

    const stateForQuery = {
      callback: callback,
      allSourcesAttemptedCallback: allSourcesAttemptedCallback,
      totalExpected: 0,
      contentType: contentType,
      earliestTimeBySource: new Map(),
      eventsByProcessAndLogicalClock: new Map(),
      eventsByTime: [],
      missingProcessAndLogicalClock: new Map(),
    };

    stateForSystem.queries.set(callback, stateForQuery);

    let unregistered = false;

    return {
      advance: (additionalCount: number) => {
        if (!unregistered) {
          void this.advanceInternal(
            stateForQuery,
            additionalCount,
            contentType,
            system,
          );
        }
      },
      unregister: () => {
        unregistered = true;

        stateForSystem.queries.delete(callback);
      },
    };
  }

  private async advanceInternal(
    stateForQuery: StateForQuery,
    additionalCount: number,
    contentType: Models.ContentType.ContentType,
    system: Models.PublicKey.PublicKey,
  ): Promise<void> {
    if (stateForQuery.totalExpected - stateForQuery.eventsByTime.length > 0) {
      return;
    }

    stateForQuery.totalExpected += additionalCount;

    await Promise.allSettled([
      this._useNetwork &&
        this.loadFromNetwork(system, stateForQuery, contentType),
      this._useDisk && this.loadFromDisk(system, stateForQuery),
    ]);

    stateForQuery.allSourcesAttemptedCallback?.();
  }

  private async loadFromDisk(
    system: Models.PublicKey.PublicKey,
    stateForQuery: StateForQuery,
  ): Promise<void> {
    const events = await this._processHandle
      .store()
      .indexEventsForSystemByTime.queryIndexSystemContentTypeUnixMillisecondsProcess(
        system,
        stateForQuery.contentType,
        stateForQuery.earliestTimeBySource.get('disk'),
        stateForQuery.totalExpected - stateForQuery.eventsByTime.length,
      );

    this.updateQueryBatch(
      events.map(signedEventToCell),
      [],
      'disk',
      stateForQuery,
    );
  }

  private async loadFromNetwork(
    system: Models.PublicKey.PublicKey,
    stateForQuery: StateForQuery,
    contentType: Models.ContentType.ContentType,
  ): Promise<void> {
    const systemState = await this._processHandle.loadSystemState(system);

    for (const server of systemState.servers()) {
      try {
        await this.loadFromNetworkSpecific(
          system,
          server,
          stateForQuery,
          contentType,
        );
      } catch (err) {
        console.log(err);
      }
    }
  }

  private async loadFromNetworkSpecific(
    system: Models.PublicKey.PublicKey,
    server: string,
    stateForQuery: StateForQuery,
    contentType: Models.ContentType.ContentType,
  ): Promise<void> {
    const response = await APIMethods.getQueryIndex(
      server,
      system,
      contentType,
      stateForQuery.earliestTimeBySource.get(server),
      Long.fromNumber(
        stateForQuery.totalExpected - stateForQuery.eventsByTime.length,
      ),
    );

    this.updateQueryBatch(
      response.events.map(signedEventToCell),
      response.proof.map(signedEventToCell),
      server,
      stateForQuery,
    );
  }

  public update(signedEvent: Models.SignedEvent.SignedEvent): void {
    const event = Models.Event.fromBuffer(signedEvent.event);

    const systemString = Models.PublicKey.toString(event.system);

    const stateForSystem = this._state.get(systemString);

    if (stateForSystem === undefined) {
      return;
    }

    for (const stateForQuery of stateForSystem.queries.values()) {
      this.updateQueryBatch(
        [signedEventToCell(signedEvent)],
        [],
        'unknown',
        stateForQuery,
      );
    }
  }

  private validateBatchIsRelevant(
    events: readonly Cell[],
    contentType: Models.ContentType.ContentType,
  ): boolean {
    return events.every((cell) => cell.contentType.equals(contentType));
  }

  private validateBatchIsSorted(events: Cell[]): boolean {
    for (let i = 0; i < events.length - 1; i++) {
      if (compareCells(events[i], events[i + 1]) !== 1) {
        return false;
      }
    }

    return true;
  }

  private validateIntegrity(stateForQuery: StateForQuery): Cell[] {
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

      if (Models.Process.equal(nextEventByTime.process, currentEvent.process)) {
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
            nextEventByTime.unixMilliseconds,
          )
        ) {
          missingAfter.push(currentEvent);
          continue;
        }
      }
    }

    const missingSlots = [];

    for (const missing of missingAfter) {
      const placeholder = {
        unixMilliseconds: missing.unixMilliseconds,
        process: missing.process,
        logicalClock: missing.logicalClock.subtract(Long.UONE),
        contentType: stateForQuery.contentType,
        next: undefined,
        signedEvent: undefined,
        key: processAndLogicalClockToString(
          missing.process,
          missing.logicalClock.subtract(Long.UONE),
        ),
        isDelete: false,
      };

      const key = processAndLogicalClockToString(
        placeholder.process,
        placeholder.logicalClock,
      );

      if (!stateForQuery.missingProcessAndLogicalClock.has(key)) {
        stateForQuery.missingProcessAndLogicalClock.set(key, placeholder);

        missingSlots.push(placeholder);
      }
    }

    return missingSlots;
  }

  private updateQueryBatch(
    cells: Cell[],
    proofCells: Cell[],
    source: string,
    stateForQuery: StateForQuery,
  ): void {
    const allCells = cells.concat(proofCells);

    if (cells.length === 0) {
      return;
    }

    if (!this.validateBatchIsRelevant(cells, stateForQuery.contentType)) {
      return;
    }

    if (!this.validateBatchIsSorted(cells)) {
      console.warn('batch failed sort validation');

      return;
    }

    let earliestTime = stateForQuery.earliestTimeBySource.get(source);

    const cellsToAdd = [];
    const cellsToRemove = new Set<string>();

    for (const cell of cells) {
      if (!stateForQuery.eventsByProcessAndLogicalClock.has(cell.key)) {
        stateForQuery.eventsByTime.push(cell);

        if (!cell.isDelete) {
          cellsToAdd.push(cell);
        }

        const placeholder = stateForQuery.missingProcessAndLogicalClock.get(
          cell.key,
        );

        if (placeholder !== undefined) {
          stateForQuery.missingProcessAndLogicalClock.delete(cell.key);

          cellsToRemove.add(placeholder.key);
        }
      } else if (cell.isDelete) {
        cellsToRemove.add(cell.key);
      }

      if (
        earliestTime === undefined ||
        earliestTime.greaterThan(cell.unixMilliseconds)
      ) {
        earliestTime = cell.unixMilliseconds;
      }
    }

    if (earliestTime === undefined) {
      throw Error('impossible');
    }

    stateForQuery.earliestTimeBySource.set(source, earliestTime);

    for (const cell of allCells) {
      stateForQuery.eventsByProcessAndLogicalClock.set(cell.key, cell);
    }

    stateForQuery.eventsByTime.sort(compareCells).reverse();

    const addMissingAfter = this.validateIntegrity(stateForQuery);

    stateForQuery.callback({
      add: cellsToAdd.concat(addMissingAfter).sort(compareCells).reverse(),
      remove: cellsToRemove,
    });

    if (source !== 'unknown' && allCells.length > 0) {
      const signedEvents = [];

      for (const cell of allCells) {
        if (cell.signedEvent) {
          signedEvents.push(cell.signedEvent);
        }
      }

      this.onLoadedBatch?.({
        origin: this,
        signedEvents: signedEvents,
        source: source,
      });
    }
  }
}
