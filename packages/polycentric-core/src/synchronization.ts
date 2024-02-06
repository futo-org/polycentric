import Long from 'long';

import * as APIMethods from './api-methods';
import * as ProcessHandle from './process-handle';
import * as Models from './models';
import * as Store from './store';
import * as Ranges from './ranges';
import * as Protocol from './protocol';
import * as Queries from './queries';
import * as Util from './util';
import { CancelContext } from './cancel-context';

async function loadRanges(
    store: Store.Store,
    system: Models.PublicKey.PublicKey,
    process: Models.Process.Process,
    ranges: Array<Ranges.IRange>,
    cancelContext: CancelContext,
): Promise<Array<Models.SignedEvent.SignedEvent>> {
    const result: Array<Models.SignedEvent.SignedEvent> = [];

    for (const range of ranges) {
        for (
            let i = range.low;
            i.lessThanOrEqual(range.high);
            i = i.add(Long.UONE)
        ) {
            const event = await store.indexEvents.getSignedEvent(
                system,
                process,
                i,
            );

            if (cancelContext.cancelled()) {
                return result;
            }

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
            .indexProcessStates.getProcessState(
                system,
                Models.Process.fromProto(item.process),
            );

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

        const events = await APIMethods.getEvents(
            server,
            system,
            Models.Ranges.rangesForSystemFromProto({
                rangesForProcesses: [
                    {
                        process: item.process,
                        ranges: batch,
                    },
                ],
            }),
        );

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
                    .indexProcessStates.getProcessState(system, process);

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
                    new CancelContext(),
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

type FollowingState = {
    cancelContext: CancelContext;
};

function taskPerItemInSet<Key, SetItem, State>(
    states: Map<Key, State>,
    updatedSet: ReadonlySet<SetItem>,
    setItemToKey: (setItem: SetItem) => Key,
    onAdd: (setItem: SetItem) => State,
    onRemove: (state: State) => void,
): void {
    for (const setItem of updatedSet) {
        const key = setItemToKey(setItem);

        const existingItem = states.get(key);

        if (!existingItem) {
            states.set(key, onAdd(setItem));
        }
    }

    const updatedSetKeys = new Set([...updatedSet.keys()].map(setItemToKey));

    const removed = [...states].filter(([key]) => !updatedSetKeys.has(key));

    for (const [key, state] of removed.values()) {
        onRemove(state);

        states.delete(key);
    }
}

export class Synchronizer {
    private serverStates: Map<string, ServerState>;

    private followingStates: Map<
        Models.PublicKey.PublicKeyString,
        CancelContext
    >;

    private complete: boolean;

    private readonly processHandle: ProcessHandle.ProcessHandle;
    private readonly unsubscribe: () => void;
    private readonly cancelContext: CancelContext;

    public constructor(processHandle: ProcessHandle.ProcessHandle) {
        this.serverStates = new Map();
        this.followingStates = new Map();
        this.complete = false;

        this.processHandle = processHandle;

        const queryServersSubscription =
            Queries.QueryServers.queryServersObservable(
                this.processHandle.queryManager.queryServers,
                this.processHandle.system(),
            ).subscribe(this.updateServerList.bind(this));

        const queryFollowersSubscription =
            Queries.QueryCRDTSet.queryCRDTSetCompleteObservable(
                this.processHandle.queryManager.queryCRDTSet,
                this.processHandle.system(),
                Models.ContentType.ContentTypeFollow,
                Models.PublicKey.fromBuffer,
            ).subscribe(this.updateFollowingList.bind(this));

        this.unsubscribe = () => {
            queryServersSubscription.unsubscribe();
            queryFollowersSubscription.unsubscribe();
        };

        this.cancelContext = new CancelContext();

        this.backfillClientForSystem(
            processHandle.system(),
            this.cancelContext,
        );
    }

    public async debugWaitUntilSynchronizationComplete(): Promise<void> {
        while (true) {
            if (this.complete) {
                return;
            }

            await Util.sleep(100);
        }
    }

    private updateFollowingList(
        latestFollowing: ReadonlySet<Models.PublicKey.PublicKey>,
    ): void {
        taskPerItemInSet(
            this.followingStates,
            latestFollowing,
            (publicKey) => {
                return Models.PublicKey.toString(publicKey);
            },
            (system) => {
                const cancelContext = new CancelContext();

                this.backfillClientForSystem(system, cancelContext);

                return cancelContext;
            },
            (cancelContext) => {
                cancelContext.cancel();
            },
        );
    }

    private updateServerList(servers: ReadonlySet<string>): void {
        const updatedServerStates = new Map();

        for (const server of servers.values()) {
            updatedServerStates.set(
                server,
                this.serverStates.get(server) || {
                    generation: 0,
                    active: false,
                },
            );
        }

        this.serverStates = updatedServerStates;
        this.synchronizationHint();
    }

    public async synchronizationHint(): Promise<void> {
        if (this.cancelContext.cancelled()) {
            return;
        }

        this.complete = false;

        for (const serverState of this.serverStates.values()) {
            serverState.generation++;
        }

        // if every server currently being backfilled then skip
        if ([...this.serverStates.values()].every((state) => state.active)) {
            return;
        }

        const localSystemRanges = await loadLocalSystemRanges(
            this.processHandle,
            this.processHandle.system(),
        );

        let incomplete = false;

        await Promise.all(
            Array.from(this.serverStates.entries()).map(
                async ([server, serverState]) => {
                    // already synchronizing so skip
                    if (serverState.active) {
                        return;
                    }

                    const generation = serverState.generation;

                    serverState.active = true;

                    try {
                        await this.backfillServer(server, localSystemRanges);
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
                },
            ),
        );

        if (!incomplete) {
            this.complete = true;
        }
    }

    private async backfillServer(
        server: string,
        localSystemRanges: ReadonlySystemRanges,
    ): Promise<void> {
        const remoteSystemRanges = await loadRemoteSystemRanges(
            server,
            this.processHandle.system(),
        );

        if (this.cancelContext.cancelled()) {
            return;
        }

        const remoteNeedsAndLocalHas = subtractSystemRanges(
            localSystemRanges,
            remoteSystemRanges,
        );

        while (
            !this.cancelContext.cancelled() &&
            (await syncToServerSingleBatch(
                server,
                this.processHandle,
                this.processHandle.system(),
                remoteNeedsAndLocalHas,
                this.cancelContext,
            ))
        ) {}
    }

    private async backfillClientForSystem(
        system: Models.PublicKey.PublicKey,
        cancelContext: CancelContext,
    ): Promise<void> {
        const serverStates = new Map<string, CancelContext>();

        const subscription = Queries.QueryServers.queryServersObservable(
            this.processHandle.queryManager.queryServers,
            system,
        ).subscribe((updatedServers) => {
            taskPerItemInSet(
                serverStates,
                updatedServers,
                (server) => {
                    return server;
                },
                (server) => {
                    const cancelContext = new CancelContext();

                    this.backfillClientFromServerForSystem(
                        server,
                        system,
                        cancelContext,
                    );

                    return cancelContext;
                },
                (cancelContext) => {
                    cancelContext.cancel();
                },
            );
        });

        cancelContext.addCallback(subscription.unsubscribe.bind(subscription));
    }

    private async backfillClientFromServerForSystem(
        server: string,
        system: Models.PublicKey.PublicKey,
        cancelContext: CancelContext,
    ): Promise<void> {
        const remoteSystemRanges = await loadRemoteSystemRanges(server, system);

        if (!cancelContext.cancelled()) {
            return;
        }

        const localSystemRanges = await loadLocalSystemRanges(
            this.processHandle,
            system,
        );

        if (!cancelContext.cancelled()) {
            return;
        }

        const remoteHasAndLocalNeeds = subtractSystemRanges(
            remoteSystemRanges,
            localSystemRanges,
        );

        while (
            !cancelContext.cancelled() &&
            (await syncFromServerSingleBatch(
                server,
                this.processHandle,
                system,
                remoteHasAndLocalNeeds,
                cancelContext,
            ))
        ) {}
    }

    public cleanup(): void {
        this.unsubscribe();
        this.cancelContext.cancel();
    }
}

type SystemRanges = Map<Models.Process.Process, Array<Ranges.IRange>>;

type ReadonlySystemRanges = ReadonlyMap<
    Models.Process.Process,
    ReadonlyArray<Ranges.IRange>
>;

async function loadLocalSystemRanges(
    processHandle: ProcessHandle.ProcessHandle,
    system: Models.PublicKey.PublicKey,
): Promise<SystemRanges> {
    const systemRanges = new Map();

    const systemState = await processHandle.loadSystemState(system);

    for (const process of systemState.processes()) {
        const processState = await processHandle
            .store()
            .indexProcessStates.getProcessState(system, process);

        systemRanges.set(process, processState.ranges);
    }

    return systemRanges;
}

async function loadRemoteSystemRanges(
    server: string,
    system: Models.PublicKey.PublicKey,
): Promise<SystemRanges> {
    const systemRanges = new Map();

    const remoteSystemRanges = await APIMethods.getRanges(server, system);

    for (const remoteProcessRanges of remoteSystemRanges.rangesForProcesses) {
        systemRanges.set(
            remoteProcessRanges.process,
            remoteProcessRanges.ranges,
        );
    }

    return systemRanges;
}

function subtractSystemRanges(
    alpha: ReadonlySystemRanges,
    omega: ReadonlySystemRanges,
): SystemRanges {
    const result = new Map();

    for (const [process, alphaRanges] of alpha.entries()) {
        const omegaRanges = omega.get(process);

        if (omegaRanges) {
            result.set(process, Ranges.subtractRange(alphaRanges, omegaRanges));
        } else {
            result.set(process, Ranges.deepCopy(alphaRanges));
        }
    }

    return result;
}

async function syncToServerSingleBatch(
    server: string,
    processHandle: ProcessHandle.ProcessHandle,
    system: Models.PublicKey.PublicKey,
    remoteNeedsAndLocalHas: SystemRanges,
    cancelContext: CancelContext,
): Promise<boolean> {
    let progress = false;

    for (const [process, ranges] of remoteNeedsAndLocalHas.entries()) {
        if (ranges.length === 0) {
            continue;
        }

        const batch = Ranges.takeRangesMaxItems(ranges, new Long(20, 0, true));

        const events = await loadRanges(
            processHandle.store(),
            system,
            process,
            batch,
            cancelContext,
        );

        if (cancelContext.cancelled()) {
            return progress;
        }

        await APIMethods.postEvents(server, events);

        if (cancelContext.cancelled()) {
            return progress;
        }

        remoteNeedsAndLocalHas.set(
            process,
            Ranges.subtractRange(ranges, batch),
        );

        progress = true;

        break;
    }

    return progress;
}

async function syncFromServerSingleBatch(
    server: string,
    processHandle: ProcessHandle.ProcessHandle,
    system: Models.PublicKey.PublicKey,
    remoteHasAndLocalNeeds: SystemRanges,
    cancelContext: CancelContext,
): Promise<boolean> {
    let progress = false;

    for (const [process, ranges] of remoteHasAndLocalNeeds.entries()) {
        if (ranges.length === 0) {
            continue;
        }

        const batch = Ranges.takeRangesMaxItems(ranges, new Long(20, 0, true));

        const events = await APIMethods.getEvents(
            server,
            system,
            Models.Ranges.rangesForSystemFromProto({
                rangesForProcesses: [
                    {
                        process: process,
                        ranges: batch,
                    },
                ],
            }),
        );

        if (cancelContext.cancelled()) {
            return progress;
        }

        await saveBatch(processHandle, events);

        if (cancelContext.cancelled()) {
            return progress;
        }

        remoteHasAndLocalNeeds.set(
            process,
            Ranges.subtractRange(ranges, batch),
        );

        progress = true;

        break;
    }

    return progress;
}
