import Long from 'long';

import * as APIMethods from './api-methods';
import * as ProcessHandle from './process-handle';
import * as Models from './models';
import * as Store from './store';
import * as Ranges from './ranges';
import * as Protocol from './protocol';
import * as Queries from './queries';
import * as Util from './util';

async function loadRanges(
    store: Store.Store,
    system: Models.PublicKey.PublicKey,
    process: Models.Process.Process,
    ranges: Array<Ranges.IRange>,
): Promise<Array<Models.SignedEvent.SignedEvent>> {
    const result: Array<Models.SignedEvent.SignedEvent> = [];

    for (const range of ranges) {
        for (
            let i = range.low;
            i.lessThanOrEqual(range.high);
            i = i.add(Long.UONE)
        ) {
            const event = await store.getSignedEvent(system, process, i);

            if (event) {
                result.push(event);
            }
        }
    }

    return result;
}

export async function saveBatch(
    processHandle: ProcessHandle.ProcessHandle,
    events: Models.Events.Type,
): Promise<void> {
    for (const signedEvent of events.events) {
        await processHandle.ingest(signedEvent);
    }
}

export async function backfillClient(
    processHandle: ProcessHandle.ProcessHandle,
    system: Models.PublicKey.PublicKey,
    server: string,
): Promise<boolean> {
    const rangesForSystem = await APIMethods.getRanges(server, system);

    let progress = false;

    for (const item of rangesForSystem.rangesForProcesses) {
        if (!item.process) {
            continue;
        }

        const processState = await processHandle
            .store()
            .getProcessState(system, Models.Process.fromProto(item.process));

        const clientNeeds = Ranges.subtractRange(
            item.ranges,
            processState.ranges,
        );

        if (clientNeeds.length === 0) {
            continue;
        }

        const batch = Ranges.takeRangesMaxItems(
            clientNeeds,
            new Long(10, 0, true),
        );

        const events = await APIMethods.getEvents(server, system, {
            rangesForProcesses: [
                {
                    process: item.process,
                    ranges: batch,
                },
            ],
        });

        if (events.events.length > 0) {
            progress = true;
        }

        await saveBatch(processHandle, events);
    }

    return progress;
}

export async function backFillServers(
    processHandle: ProcessHandle.ProcessHandle,
    system: Models.PublicKey.PublicKey,
): Promise<boolean> {
    const systemState = await processHandle.loadSystemState(system);

    let progress = false;

    for (const server of systemState.servers()) {
        try {
            const rangesForSystem = await APIMethods.getRanges(server, system);

            for (const process of systemState.processes()) {
                let rangesForProcess: Array<Protocol.Range> = [];

                for (const item of rangesForSystem.rangesForProcesses) {
                    if (!item.process) {
                        continue;
                    }

                    if (
                        Models.Process.equal(
                            Models.Process.fromProto(item.process),
                            process,
                        )
                    ) {
                        rangesForProcess = item.ranges;
                        break;
                    }
                }

                const processState = await processHandle
                    .store()
                    .getProcessState(system, process);

                const serverNeeds = Ranges.subtractRange(
                    processState.ranges,
                    rangesForProcess,
                );

                if (serverNeeds.length === 0) {
                    continue;
                }

                const batch = Ranges.takeRangesMaxItems(
                    serverNeeds,
                    new Long(20, 0, true),
                );

                const events = await loadRanges(
                    processHandle.store(),
                    system,
                    process,
                    batch,
                );

                await APIMethods.postEvents(server, events);

                progress = true;
            }
        } catch (err) {
            console.warn(err);
        }
    }

    return progress;
}

type ServerState = {
    generation: number;
    active: boolean;
};

export class Synchronizer {
    private queryState: Array<Queries.QueryIndex.Cell>;
    private servers: Set<string>;
    private serverState: Map<string, ServerState>;
    private complete: boolean;

    private readonly processHandle: ProcessHandle.ProcessHandle;
    private readonly queryHandle: Queries.QueryCRDTSet.QueryHandle;

    public constructor(
        processHandle: ProcessHandle.ProcessHandle,
        queryManager: Queries.QueryManager.QueryManager,
    ) {
        this.queryState = [];
        this.servers = new Set();
        this.serverState = new Map();
        this.complete = false;

        this.processHandle = processHandle;

        this.queryHandle = queryManager.queryCRDTSet.query(
            processHandle.system(),
            Models.ContentType.ContentTypeServer,
            this.updateServerList.bind(this),
        );

        this.queryHandle.advance(10);
    }

    public async debugWaitUntilSynchronizationComplete(): Promise<void> {
        while (true) {
            if (this.complete) {
                return;
            }

            await Util.sleep(100);
        }
    }

    private updateServerList(
        patch: Queries.QueryIndex.CallbackParameters,
    ): void {
        this.queryState = Queries.QueryIndex.applyPatch(this.queryState, patch);

        if (
            patch.add.length > 0 &&
            patch.add[patch.add.length - 1].signedEvent !== undefined
        ) {
            console.log('done loading server list');
        } else {
            this.queryHandle.advance(10);
        }

        const servers = new Set<string>();

        for (const cell of this.queryState) {
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

            servers.add(Util.decodeText(event.lwwElementSet.value));
        }

        this.servers = servers;

        this.synchronizationHint();
    }

    public async synchronizationHint(): Promise<void> {
        for (const server of this.servers) {
            let serverState = this.serverState.get(server);

            if (serverState === undefined) {
                serverState = {
                    active: false,
                    generation: 0,
                };

                this.serverState.set(server, serverState);
            }
        }

        for (const serverState of this.serverState.values()) {
            serverState.generation++;
        }

        // if every server currently being backfilled then skip
        if ([...this.serverState.values()].every((state) => state.active)) {
            return;
        }

        const systemState = await this.processHandle.loadSystemState(
            this.processHandle.system(),
        );

        const processesRanges: Map<
            Readonly<Models.Process.Process>,
            ReadonlyArray<Ranges.IRange>
        > = new Map();

        for (const process of systemState.processes()) {
            const processState = await this.processHandle
                .store()
                .getProcessState(this.processHandle.system(), process);

            processesRanges.set(process, processState.ranges);
        }

        let incomplete = false;

        for (const server of this.servers.values()) {
            const serverState = this.serverState.get(server);

            if (serverState === undefined) {
                throw new Error('impossible');
            }

            // already synchronizing so skip
            if (serverState.active) {
                return;
            }

            const generation = serverState.generation;

            serverState.active = true;

            try {
                await this.backfillServer(server, processesRanges);
            } catch (err) {
                incomplete = true;

                console.warn(err);
            }

            serverState.active = false;

            // our view of the world became outdated while synchronizing
            if (generation < serverState.generation) {
                incomplete = true;

                this.synchronizationHint();
            }
        }

        if (!incomplete) {
            this.complete = true;
        }
    }

    private async backfillServer(
        server: string,
        localProcessesRanges: ReadonlyMap<
            Readonly<Models.Process.Process>,
            ReadonlyArray<Ranges.IRange>
        >,
    ): Promise<void> {
        console.log('backfilling server', server);

        const remoteRangesForSystem = await APIMethods.getRanges(
            server,
            this.processHandle.system(),
        );

        const remoteNeedsByProcess: Map<
            Models.Process.Process,
            Array<Ranges.IRange>
        > = new Map();

        for (const [process, localRanges] of localProcessesRanges.entries()) {
            remoteNeedsByProcess.set(
                process,
                Ranges.deepCopy(localRanges) as Array<Ranges.IRange>,
            );

            for (const item of remoteRangesForSystem.rangesForProcesses) {
                if (!item.process) {
                    console.warn('remoteRangesForSystem no process in item');

                    continue;
                }

                if (
                    Models.Process.equal(
                        process,
                        Models.Process.fromProto(item.process),
                    )
                ) {
                    const remoteNeeds = Ranges.subtractRange(
                        localRanges,
                        item.ranges,
                    );

                    if (remoteNeeds.length === 0) {
                        continue;
                    }

                    remoteNeedsByProcess.set(process, remoteNeeds);
                }
            }
        }

        let progress = true;

        while (progress) {
            progress = false;

            for (const [
                process,
                remoteNeeds,
            ] of remoteNeedsByProcess.entries()) {
                if (remoteNeeds.length === 0) {
                    continue;
                }

                progress = true;

                const batch = Ranges.takeRangesMaxItems(
                    remoteNeeds,
                    new Long(20, 0, true),
                );

                remoteNeedsByProcess.set(
                    process,
                    Ranges.subtractRange(remoteNeeds, batch),
                );

                const events = await loadRanges(
                    this.processHandle.store(),
                    this.processHandle.system(),
                    process,
                    batch,
                );

                console.log(
                    'sending',
                    server,
                    'process',
                    Models.Process.toString(process),
                    'ranges',
                    batch,
                );

                await APIMethods.postEvents(server, events);
            }
        }

        console.log('done backfilling server', server);
    }

    public cleanup(): void {
        this.queryHandle.unregister();
    }
}
