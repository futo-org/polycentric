import Long from 'long';

import * as ProcessHandle from '../process-handle';
import * as APIMethods from '../api-methods';
import * as Models from '../models';
import * as Shared from './shared';

export type CallbackParameters = {
    add: Array<Models.SignedEvent.SignedEvent>;
    remove: Array<Models.SignedEvent.SignedEvent>;
};

type Callback = (state: CallbackParameters) => void;

type EventMemo = {
    signedEvent: Models.SignedEvent.SignedEvent;
    event: Models.Event.Event;
};

type StateForQuery = {
    callback: Callback;
    totalExpected: number;
    contentType: Models.ContentType.ContentType;
    events: Map<Models.Process.ProcessString, Array<EventMemo>>;
    earliestTime: Long | undefined;
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
            events: new Map(),
            earliestTime: undefined,
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
        let totalEvents = 0;

        for (const eventsForProcess in stateForQuery.events.values()) {
            totalEvents += eventsForProcess.length;
        }

        const events = await this._processHandle
            .store()
            .queryIndexSystemContentTypeUnixMillisecondsProcess(
                system,
                stateForQuery.contentType,
                stateForQuery.earliestTime,
                stateForQuery.totalExpected - totalEvents,
            );

        for (const event of events) {
            this.update(Models.SignedEvent.fromProto(event));
        }
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
        let totalEvents = 0;

        for (const eventsForProcess in stateForQuery.events.values()) {
            totalEvents += eventsForProcess.length;
        }

        const response = await APIMethods.getQueryIndex(
            server,
            system,
            Models.ContentType.ContentTypeClaim,
            stateForQuery.earliestTime,
            Long.fromNumber(stateForQuery.totalExpected - totalEvents),
        );

        for (const event of response.events) {
            this.update(Models.SignedEvent.fromProto(event));
        }
    }

    public update(signedEvent: Models.SignedEvent.SignedEvent): void {
        const event = Models.Event.fromBuffer(signedEvent.event);

        const systemString = Models.PublicKey.toString(event.system);

        let stateForSystem = this._state.get(systemString);

        if (stateForSystem === undefined) {
            return;
        }

        for (const stateForQuery of stateForSystem.queries.values()) {
            this.updateQuery(signedEvent, event, stateForQuery);
        }
    }

    private updateQuery(
        signedEvent: Models.SignedEvent.SignedEvent,
        event: Models.Event.Event,
        stateForQuery: StateForQuery,
    ): void {
        if (event.contentType.notEquals(stateForQuery.contentType)) {
            return;
        }

        if (event.unixMilliseconds === undefined) {
            return;
        }

        let totalEvents = 0;

        for (const eventsForProcess in stateForQuery.events.values()) {
            totalEvents += eventsForProcess.length;
        }

        if (totalEvents >= stateForQuery.totalExpected) {
            return;
        }

        if (
            stateForQuery.earliestTime === undefined ||
            stateForQuery.earliestTime.greaterThan(event.unixMilliseconds)
        ) {
            stateForQuery.earliestTime = event.unixMilliseconds;
        }

        const processString = Models.Process.toString(event.process);

        let eventsForProcess = stateForQuery.events.get(processString);

        if (eventsForProcess === undefined) {
            eventsForProcess = [];

            stateForQuery.events.set(processString, eventsForProcess);
        }

        eventsForProcess.push({
            signedEvent: signedEvent,
            event: event,
        });

        stateForQuery.callback({
            add: [signedEvent],
            remove: [],
        });
    }
}
