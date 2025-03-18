import Long from 'long';

import * as APIMethods from './api-methods';
import { CancelContext } from './cancel-context';
import * as Models from './models';
import * as ProcessHandle from './process-handle';
import * as Protocol from './protocol';
import * as Queries from './queries';
import * as Ranges from './ranges';
import * as Store from './store';
import * as Util from './util';

async function loadRanges(
  store: Store.Store,
  system: Models.PublicKey.PublicKey,
  process: Models.Process.Process,
  ranges: Ranges.IRange[],
  cancelContext: CancelContext,
): Promise<Models.SignedEvent.SignedEvent[]> {
  const result: Models.SignedEvent.SignedEvent[] = [];

  for (const range of ranges) {
    for (
      let i = range.low;
      i.lessThanOrEqual(range.high);
      i = i.add(Long.UONE)
    ) {
      const event = await store.indexEvents.getSignedEvent(system, process, i);

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
        let rangesForProcess: Protocol.Range[] = [];

        for (const item of rangesForSystem.rangesForProcesses) {
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

interface ServerState {
  generation: number;
  active: boolean;
}

export class Synchronizer {
  private serverStates: Map<string, ServerState>;
  private complete: boolean;

  private followingStates: Map<Models.PublicKey.PublicKeyString, CancelContext>;

  private readonly processHandle: ProcessHandle.ProcessHandle;
  private readonly unsubscribe: () => void;
  private readonly cancelContext: CancelContext;

  public constructor(processHandle: ProcessHandle.ProcessHandle) {
    this.serverStates = new Map();
    this.followingStates = new Map();
    this.complete = false;

    this.processHandle = processHandle;
    this.cancelContext = new CancelContext();

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

    this.backfillClientForSystem(processHandle.system(), this.cancelContext);
  }

  public async debugWaitUntilSynchronizationComplete(): Promise<void> {
    while (!this.complete) {
      await Util.sleep(100);
    }
  }

  private updateFollowingList(
    latestFollowing: ReadonlySet<Models.PublicKey.PublicKey>,
  ): void {
    Util.taskPerItemInSet(
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
    const updatedServerStates = new Map<string, ServerState>();

    for (const server of servers.values()) {
      updatedServerStates.set(
        server,
        this.serverStates.get(server) ?? {
          generation: 0,
          active: false,
        },
      );
    }

    this.serverStates = updatedServerStates;
    void this.synchronizationHint();
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
      this.cancelContext,
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

            void this.synchronizationHint();
          }
        },
      ),
    );

    /* eslint @typescript-eslint/no-unnecessary-condition: 0 */
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

  private backfillClientForSystem(
    system: Models.PublicKey.PublicKey,
    cancelContext: CancelContext,
  ): void {
    const serverStates = new Map<string, CancelContext>();

    const subscription = Queries.QueryServers.queryServersObservable(
      this.processHandle.queryManager.queryServers,
      system,
    ).subscribe((updatedServers) => {
      Util.taskPerItemInSet(
        serverStates,
        updatedServers,
        (server) => {
          return server;
        },
        (server) => {
          const cancelContext = new CancelContext();

          void this.backfillClientFromServerForSystem(
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
    try {
      const remoteSystemRanges = await loadRemoteSystemRanges(server, system);

      if (cancelContext.cancelled()) {
        return;
      }

      const localSystemRanges = await loadLocalSystemRanges(
        this.processHandle,
        system,
        this.cancelContext,
      );

      if (cancelContext.cancelled()) {
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
    } catch (err) {
      console.warn(err);
    }
  }

  public cleanup(): void {
    this.unsubscribe();
    this.cancelContext.cancel();
  }
}

interface ProcessRanges {
  process: Models.Process.Process;
  ranges: Ranges.IRange[];
}

type SystemRanges = Map<Models.Process.ProcessString, ProcessRanges>;

type ReadonlySystemRanges = ReadonlyMap<
  Models.Process.ProcessString,
  Readonly<ProcessRanges>
>;

async function loadLocalSystemRanges(
  processHandle: ProcessHandle.ProcessHandle,
  system: Models.PublicKey.PublicKey,
  cancelContext: CancelContext,
): Promise<SystemRanges> {
  const systemRanges: SystemRanges = new Map();

  const systemState = await processHandle.loadSystemState(system);

  if (cancelContext.cancelled()) {
    return systemRanges;
  }

  for (const process of systemState.processes()) {
    const processState = await processHandle
      .store()
      .indexProcessStates.getProcessState(system, process);

    if (cancelContext.cancelled()) {
      return systemRanges;
    }

    systemRanges.set(Models.Process.toString(process), {
      process: process,
      ranges: processState.ranges,
    });
  }

  return systemRanges;
}

async function loadRemoteSystemRanges(
  server: string,
  system: Models.PublicKey.PublicKey,
): Promise<SystemRanges> {
  const systemRanges: SystemRanges = new Map();

  const remoteSystemRanges = await APIMethods.getRanges(server, system);

  for (const remoteProcessRanges of remoteSystemRanges.rangesForProcesses) {
    systemRanges.set(Models.Process.toString(remoteProcessRanges.process), {
      process: remoteProcessRanges.process,
      ranges: remoteProcessRanges.ranges,
    });
  }

  return systemRanges;
}

function subtractSystemRanges(
  alpha: ReadonlySystemRanges,
  omega: ReadonlySystemRanges,
): SystemRanges {
  const result: SystemRanges = new Map();

  for (const [processString, alphaRangesForProcess] of alpha.entries()) {
    const omegaRangesForProcess = omega.get(processString);

    if (omegaRangesForProcess) {
      result.set(processString, {
        process: alphaRangesForProcess.process,
        ranges: Ranges.subtractRange(
          alphaRangesForProcess.ranges,
          omegaRangesForProcess.ranges,
        ),
      });
    } else {
      result.set(processString, {
        process: alphaRangesForProcess.process,
        ranges: Ranges.deepCopy(alphaRangesForProcess.ranges),
      });
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

  for (const rangesForProcess of remoteNeedsAndLocalHas.values()) {
    if (rangesForProcess.ranges.length === 0) {
      continue;
    }

    const batch = Ranges.takeRangesMaxItems(
      rangesForProcess.ranges,
      new Long(20, 0, true),
    );

    const events = await loadRanges(
      processHandle.store(),
      system,
      rangesForProcess.process,
      batch,
      cancelContext,
    );

    if (cancelContext.cancelled()) {
      return progress;
    }

    try {
      await APIMethods.postEvents(server, events);

      // After successful post, record server acknowledgment for each event
      for (const event of events) {
        processHandle.recordServerAck(event, server);
      }
    } catch (err) {
      console.warn('Failed to post events to server:', err);
      return progress;
    }

    if (cancelContext.cancelled()) {
      return progress;
    }

    rangesForProcess.ranges = Ranges.subtractRange(
      rangesForProcess.ranges,
      batch,
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

  for (const rangesForProcess of remoteHasAndLocalNeeds.values()) {
    if (rangesForProcess.ranges.length === 0) {
      continue;
    }

    const batch = Ranges.takeRangesMaxItems(
      rangesForProcess.ranges,
      new Long(20, 0, true),
    );

    const events = await APIMethods.getEvents(
      server,
      system,
      Models.Ranges.rangesForSystemFromProto({
        rangesForProcesses: [
          {
            process: rangesForProcess.process,
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

    rangesForProcess.ranges = Ranges.subtractRange(
      rangesForProcess.ranges,
      batch,
    );

    progress = true;

    break;
  }

  return progress;
}
