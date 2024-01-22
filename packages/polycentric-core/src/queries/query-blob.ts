import Long from 'long';
import * as RXJS from 'rxjs';

import * as APIMethods from '../api-methods';
import * as ProcessHandle from '../process-handle';
import * as Models from '../models';
import * as Shared from './shared';
import * as Ranges from '../ranges';
import * as Util from '../util';

export type Callback = (buffer: Uint8Array) => void;

type StateForQuery = {
    readonly system: Readonly<Models.PublicKey.PublicKey>;
    readonly process: Readonly<Models.Process.Process>;
    readonly wantRanges: ReadonlyArray<Ranges.IRange>;
    readonly haveRanges: Array<Ranges.IRange>;
    readonly events: Array<Models.Event.Event>;
    readonly callbacks: Set<Callback>;
    value: Uint8Array | undefined;
};

function makeKey(
    system: Models.PublicKey.PublicKey,
    process: Models.Process.Process,
    ranges: ReadonlyArray<Ranges.IRange>,
): string {
    return (
        Models.PublicKey.toString(system) +
        Models.Process.toString(process) +
        Ranges.toString(ranges)
    );
}

export class QueryManager {
    private readonly _processHandle: ProcessHandle.ProcessHandle;
    private readonly _state: Map<string, StateForQuery>;
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
        process: Models.Process.Process,
        ranges: ReadonlyArray<Ranges.IRange>,
        callback: Callback,
    ): Shared.UnregisterCallback {
        const key = makeKey(system, process, ranges);

        const stateForQuery: StateForQuery = Util.lookupWithInitial(
            this._state,
            key,
            () => {
                return {
                    system: system,
                    process: process,
                    wantRanges: ranges,
                    haveRanges: [],
                    events: [],
                    callbacks: new Set(),
                    value: undefined,
                };
            },
        );

        stateForQuery.callbacks.add(callback);

        if (stateForQuery.value !== undefined) {
            callback(stateForQuery.value);
        } else {
            if (this._useNetwork === true) {
                this.loadFromNetwork(stateForQuery);
            }

            if (this._useDisk === true) {
                this.loadFromDisk(stateForQuery);
            }
        }

        return () => {
            stateForQuery.callbacks.delete(callback);

            if (stateForQuery.callbacks.size === 0) {
                this._state.delete(key);
            }
        };
    }

    private async loadFromDisk(stateForQuery: StateForQuery): Promise<void> {
        const needRanges = Ranges.subtractRange(
            stateForQuery.wantRanges,
            stateForQuery.haveRanges,
        );

        for (const range of needRanges) {
            for (
                let i = range.low;
                i.lessThanOrEqual(range.high);
                i = i.add(Long.UONE)
            ) {
                const signedEvent = await this._processHandle
                    .store()
                    .indexEvents.getSignedEvent(
                        stateForQuery.system,
                        stateForQuery.process,
                        i,
                    );

                if (signedEvent !== undefined) {
                    this.update(signedEvent);
                }
            }
        }
    }

    private async loadFromNetwork(stateForQuery: StateForQuery): Promise<void> {
        const systemState = await this._processHandle.loadSystemState(
            stateForQuery.system,
        );

        for (const server of systemState.servers()) {
            try {
                this.loadFromNetworkSpecific(server, stateForQuery);
            } catch (err) {
                console.log(err);
            }
        }
    }

    private async loadFromNetworkSpecific(
        server: string,
        stateForQuery: StateForQuery,
    ): Promise<void> {
        const needRanges = Ranges.subtractRange(
            stateForQuery.wantRanges,
            stateForQuery.haveRanges,
        );

        const events = await APIMethods.getEvents(
            server,
            stateForQuery.system,
            {
                rangesForProcesses: [
                    {
                        process: stateForQuery.process,
                        ranges: needRanges,
                    },
                ],
            },
        );

        events.events.forEach((x) => this.update(x));
    }

    public update(signedEvent: Models.SignedEvent.SignedEvent): void {
        const event = Models.Event.fromBuffer(signedEvent.event);

        for (const stateForQuery of this._state.values()) {
            if (
                !Models.PublicKey.equal(event.system, stateForQuery.system) ||
                !Models.Process.equal(event.process, stateForQuery.process) ||
                !Ranges.contains(stateForQuery.wantRanges, event.logicalClock)
            ) {
                continue;
            }

            if (
                !Ranges.contains(stateForQuery.haveRanges, event.logicalClock)
            ) {
                Ranges.insert(stateForQuery.haveRanges, event.logicalClock);

                stateForQuery.events.push(event);
            }

            if (
                Ranges.subtractRange(
                    stateForQuery.wantRanges,
                    stateForQuery.haveRanges,
                ).length === 0
            ) {
                stateForQuery.events.sort((a, b) => {
                    return a.logicalClock.compare(b.logicalClock);
                });

                stateForQuery.value = Util.concatBuffers(
                    stateForQuery.events.map((x) => x.content),
                );

                for (const callback of stateForQuery.callbacks) {
                    callback(stateForQuery.value);
                }
            }
        }
    }
}

export function observableQuery(
    queryManager: QueryManager,
    system: Models.PublicKey.PublicKey,
    process: Models.Process.Process,
    ranges: ReadonlyArray<Ranges.IRange>,
): RXJS.Observable<Uint8Array> {
    return new RXJS.Observable((subscriber) => {
        return queryManager.query(system, process, ranges, (value) => {
            subscriber.next(value);
        });
    });
}
