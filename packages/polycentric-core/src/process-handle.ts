import * as Base64 from '@borderless/base64';
import AsyncLock from 'async-lock';
import Long from 'long';
import * as RXJS from 'rxjs';

import * as MetaStore from './meta-store';
import * as Models from './models';
import * as PersistenceDriver from './persistence-driver';
import * as Protocol from './protocol';
import * as Queries from './queries';
import * as Ranges from './ranges';
import * as Store from './store';
import * as Synchronization from './synchronization';
import * as Util from './util';

export class SystemState {
  private _servers: string[];
  private _authorities: string[];
  private _processes: Models.Process.Process[];

  public constructor(
    servers: string[],
    authorities: string[],
    processes: Models.Process.Process[],
  ) {
    this._servers = servers;
    this._authorities = authorities;
    this._processes = processes;
  }

  public servers(): string[] {
    return this._servers;
  }

  public authorities(): string[] {
    return this._authorities;
  }

  public processes(): Models.Process.Process[] {
    return this._processes;
  }
}

function protoSystemStateToSystemState(
  proto: Protocol.StorageTypeSystemState,
): SystemState {
  const processes = [];

  for (const process of proto.processes) {
    processes.push(Models.Process.fromProto(process));
  }

  return new SystemState([], [], processes);
}

export class ProcessHandle {
  private readonly _processSecret: Models.ProcessSecret.ProcessSecret;
  private readonly _store: Store.Store;
  private readonly _system: Models.PublicKey.PublicKey;
  private _listener:
    | ((signedEvent: Models.SignedEvent.SignedEvent) => void)
    | undefined;
  private readonly _addressHints: Map<
    Models.PublicKey.PublicKeyString,
    Set<string>
  >;
  private readonly _ingestLock: AsyncLock;
  private readonly _eventAcks = new Map<string, Set<string>>();
  private readonly _eventAckSubscriptions = new Map<
    string,
    Set<(serverId: string) => void>
  >();
  private readonly _eventKeyMap = new Map<string, string>();

  public readonly queryManager: Queries.QueryManager.QueryManager;
  public readonly synchronizer: Synchronization.Synchronizer;

  private constructor(
    store: Store.Store,
    processSecret: Models.ProcessSecret.ProcessSecret,
    system: Models.PublicKey.PublicKey,
  ) {
    store.system = system;
    this._store = store;
    this._processSecret = processSecret;
    this._system = system;
    this._listener = undefined;
    this._addressHints = new Map();
    this._ingestLock = new AsyncLock();
    this.queryManager = new Queries.QueryManager.QueryManager(this);
    this.synchronizer = new Synchronization.Synchronizer(this);
  }

  public addAddressHint(
    system: Models.PublicKey.PublicKey,
    server: string,
  ): void {
    const systemString = Models.PublicKey.toString(system);

    let hintsForSystem = this._addressHints.get(systemString);

    if (hintsForSystem === undefined) {
      hintsForSystem = new Set();

      this._addressHints.set(systemString, hintsForSystem);
    }

    hintsForSystem.add(server);
  }

  public getAddressHints(system: Models.PublicKey.PublicKey): Set<string> {
    const systemString = Models.PublicKey.toString(system);

    const hintsForSystem = this._addressHints.get(systemString);

    if (hintsForSystem === undefined) {
      return new Set();
    }

    return hintsForSystem;
  }

  public processSecret(): Models.ProcessSecret.ProcessSecret {
    return this._processSecret;
  }

  public system(): Models.PublicKey.PublicKey {
    return this._system;
  }

  public process(): Models.Process.Process {
    return this._processSecret.process;
  }

  public store(): Store.Store {
    return this._store;
  }

  public setListener(
    listener: (signedEvent: Models.SignedEvent.SignedEvent) => void,
  ): void {
    this._listener = listener;
  }

  private async loadEventAcks(): Promise<void> {
    const acks = await this._store.getEventAcks();

    for (const [eventKey, servers] of Object.entries(acks)) {
      // Skip empty server arrays
      if (servers.length === 0) continue;

      this._eventAcks.set(eventKey, new Set(servers));

      // Parse the key to extract system, process, and logical clock
      // Format is typically a hex string representation
      try {
        // Try to parse parts of the key to create runtime lookup keys
        const parts = eventKey.split('_');
        if (parts.length >= 3) {
          // Create a runtime lookup key - this is what getEventKey returns
          const runtimeKey = parts.join('_');

          // Map in both directions for faster lookups
          this._eventKeyMap.set(eventKey, runtimeKey);
          this._eventKeyMap.set(runtimeKey, eventKey);
        }
      } catch (e) {
        console.error('Error parsing event key:', eventKey);
      }
    }
  }

  public static async load(store: Store.Store): Promise<ProcessHandle> {
    const processSecret = await store.getProcessSecret();

    const handle = new ProcessHandle(
      store,
      processSecret,
      await Models.PrivateKey.derivePublicKey(processSecret.system),
    );
    await handle.loadEventAcks();
    return handle;
  }

  public async post(
    content: string,
    image?: Protocol.ImageManifest,
    reference?: Protocol.Reference,
  ): Promise<Models.Pointer.Pointer> {
    return await this.publish(
      Models.ContentType.ContentTypePost,
      Protocol.Post.encode({
        content: content,
        image: image,
      }).finish(),
      undefined,
      undefined,
      reference ? [reference] : [],
    );
  }

  public async opinion(
    subject: Protocol.Reference,
    opinion: Models.Opinion.Opinion,
  ): Promise<Models.Pointer.Pointer> {
    return await this.publish(
      Models.ContentType.ContentTypeOpinion,
      new Uint8Array(),
      undefined,
      {
        value: opinion,
        unixMilliseconds: Long.fromNumber(Date.now(), true),
      },
      [subject],
    );
  }

  private async setCRDTItem(
    contentType: Models.ContentType.ContentType,
    value: Uint8Array,
  ): Promise<Models.Pointer.Pointer> {
    return await this.publish(
      contentType,
      new Uint8Array(),
      undefined,
      {
        value: value,
        unixMilliseconds: Long.fromNumber(Date.now(), true),
      },
      [],
    );
  }

  private async setCRDTElementSetItem(
    contentType: Models.ContentType.ContentType,
    value: Uint8Array,
    operation: Protocol.LWWElementSet_Operation,
  ): Promise<Models.Pointer.Pointer> {
    return await this.publish(
      contentType,
      new Uint8Array(),
      {
        operation: operation,
        value: value,
        unixMilliseconds: Long.fromNumber(Date.now(), true),
      },
      undefined,
      [],
    );
  }

  public async setUsername(username: string): Promise<Models.Pointer.Pointer> {
    return await this.setCRDTItem(
      Models.ContentType.ContentTypeUsername,
      Util.encodeText(username),
    );
  }

  public async setStore(storeLink: string): Promise<Models.Pointer.Pointer> {
    return await this.setCRDTItem(
      Models.ContentType.ContentTypeStore,
      Util.encodeText(storeLink),
    );
  }

  public async setDescription(
    description: string,
  ): Promise<Models.Pointer.Pointer> {
    return await this.setCRDTItem(
      Models.ContentType.ContentTypeDescription,
      Util.encodeText(description),
    );
  }

  public async setAvatar(
    avatar: Protocol.ImageBundle,
  ): Promise<Models.Pointer.Pointer> {
    return await this.setCRDTItem(
      Models.ContentType.ContentTypeAvatar,
      Protocol.ImageBundle.encode(avatar).finish(),
    );
  }

  public async setBanner(
    banner: Protocol.ImageBundle,
  ): Promise<Models.Pointer.Pointer> {
    return await this.setCRDTItem(
      Models.ContentType.ContentTypeBanner,
      Protocol.ImageBundle.encode(banner).finish(),
    );
  }

  public async follow(
    system: Models.PublicKey.PublicKey,
  ): Promise<Models.Pointer.Pointer> {
    return await this.setCRDTElementSetItem(
      Models.ContentType.ContentTypeFollow,
      Protocol.PublicKey.encode(system).finish(),
      Protocol.LWWElementSet_Operation.ADD,
    );
  }

  public async unfollow(
    system: Models.PublicKey.PublicKey,
  ): Promise<Models.Pointer.Pointer> {
    return await this.setCRDTElementSetItem(
      Models.ContentType.ContentTypeFollow,
      Protocol.PublicKey.encode(system).finish(),
      Protocol.LWWElementSet_Operation.REMOVE,
    );
  }

  public async block(
    system: Models.PublicKey.PublicKey,
  ): Promise<Models.Pointer.Pointer> {
    return await this.setCRDTElementSetItem(
      Models.ContentType.ContentTypeBlock,
      Protocol.PublicKey.encode(system).finish(),
      Protocol.LWWElementSet_Operation.ADD,
    );
  }

  public async unblock(
    system: Models.PublicKey.PublicKey,
  ): Promise<Models.Pointer.Pointer> {
    return await this.setCRDTElementSetItem(
      Models.ContentType.ContentTypeBlock,
      Protocol.PublicKey.encode(system).finish(),
      Protocol.LWWElementSet_Operation.REMOVE,
    );
  }

  public async addServer(server: string): Promise<Models.Pointer.Pointer> {
    return await this.setCRDTElementSetItem(
      Models.ContentType.ContentTypeServer,
      Util.encodeText(server),
      Protocol.LWWElementSet_Operation.ADD,
    );
  }

  public async removeServer(server: string): Promise<Models.Pointer.Pointer> {
    return await this.setCRDTElementSetItem(
      Models.ContentType.ContentTypeServer,
      Util.encodeText(server),
      Protocol.LWWElementSet_Operation.REMOVE,
    );
  }

  public async addAuthority(server: string): Promise<Models.Pointer.Pointer> {
    return await this.setCRDTElementSetItem(
      Models.ContentType.ContentTypeAuthority,
      Util.encodeText(server),
      Protocol.LWWElementSet_Operation.ADD,
    );
  }

  public async removeAuthority(
    server: string,
  ): Promise<Models.Pointer.Pointer> {
    return await this.setCRDTElementSetItem(
      Models.ContentType.ContentTypeAuthority,
      Util.encodeText(server),
      Protocol.LWWElementSet_Operation.REMOVE,
    );
  }

  public async joinTopic(topic: string): Promise<Models.Pointer.Pointer> {
    return await this.setCRDTElementSetItem(
      Models.ContentType.ContentTypeJoinTopic,
      Util.encodeText(topic),
      Protocol.LWWElementSet_Operation.ADD,
    );
  }

  public async leaveTopic(topic: string): Promise<Models.Pointer.Pointer> {
    return await this.setCRDTElementSetItem(
      Models.ContentType.ContentTypeJoinTopic,
      Util.encodeText(topic),
      Protocol.LWWElementSet_Operation.REMOVE,
    );
  }

  public async vouch(
    pointer: Models.Pointer.Pointer,
  ): Promise<Models.Pointer.Pointer> {
    return await this.publish(
      Models.ContentType.ContentTypeVouch,
      new Uint8Array(),
      undefined,
      undefined,
      [Models.pointerToReference(pointer)],
    );
  }

  public async vouchByReference(
    reference: Protocol.Reference,
  ): Promise<Models.Pointer.Pointer> {
    return await this.publish(
      Models.ContentType.ContentTypeVouch,
      new Uint8Array(),
      undefined,
      undefined,
      [reference],
    );
  }

  public async claim(
    claimValue: Protocol.Claim,
  ): Promise<Models.Pointer.Pointer> {
    return await this.publish(
      Models.ContentType.ContentTypeClaim,
      Protocol.Claim.encode(claimValue).finish(),
      undefined,
      undefined,
      [],
    );
  }

  public async delete(
    process: Models.Process.Process,
    logicalClock: Long,
  ): Promise<Models.Pointer.Pointer | undefined> {
    const signedEvent = await this._store.indexEvents.getSignedEvent(
      this._system,
      process,
      logicalClock,
    );

    if (!signedEvent) {
      return undefined;
    }

    const event = Models.Event.fromBuffer(signedEvent.event);

    return await this.publish(
      Models.ContentType.ContentTypeDelete,
      Protocol.Delete.encode({
        process: process,
        logicalClock: logicalClock,
        indices: event.indices,
        unixMilliseconds: event.unixMilliseconds,
        contentType: event.contentType,
      }).finish(),
      undefined,
      undefined,
      [],
    );
  }

  public async publishBlob(content: Uint8Array): Promise<Ranges.IRange[]> {
    const ranges: Ranges.IRange[] = [];

    const maxBytes = 1024 * 512;

    for (let i = 0; i < content.length; i += maxBytes) {
      const pointer = await this.publish(
        Models.ContentType.ContentTypeBlobSection,
        content.slice(i, i + maxBytes),
        undefined,
        undefined,
        [],
      );

      Ranges.insert(ranges, pointer.logicalClock);
    }

    return ranges;
  }

  public async loadSystemState(
    system: Models.PublicKey.PublicKey,
  ): Promise<SystemState> {
    const protoSystemState =
      await this._store.indexSystemStates.getSystemState(system);

    const systemState = protoSystemStateToSystemState(protoSystemState);

    const loadCRDTElementSetItems = async (
      contentType: Models.ContentType.ContentType,
    ) => {
      return await this._store.indexCRDTElementSet.query(
        system,
        contentType,
        undefined,
        10,
      );
    };

    systemState
      .servers()
      .push(
        ...(
          await loadCRDTElementSetItems(Models.ContentType.ContentTypeServer)
        ).map(Util.decodeText),
      );

    systemState
      .authorities()
      .push(
        ...(
          await loadCRDTElementSetItems(Models.ContentType.ContentTypeAuthority)
        ).map(Util.decodeText),
      );

    const addressHints = this.getAddressHints(system);

    for (const address1 of addressHints) {
      let found = false;

      for (const address2 of systemState.servers()) {
        if (address1 === address2) {
          found = true;
          break;
        }
      }

      if (!found) {
        systemState.servers().push(address1);
      }
    }

    return systemState;
  }

  private async publishComputeVectorClock(): Promise<Protocol.VectorClock> {
    const head = await RXJS.firstValueFrom(
      Queries.QueryHead.queryHeadObservable(
        this.queryManager.queryHead,
        this._system,
      ).pipe(
        RXJS.switchMap((head) => {
          if (head.attemptedSources.has('disk')) {
            return RXJS.of(head);
          } else {
            return RXJS.NEVER;
          }
        }),
      ),
    );

    const vectorClock: Protocol.VectorClock = {
      logicalClocks: [],
    };

    const systemProcessesSignedEvent = head.processLists.get(
      Models.Process.toString(this._processSecret.process),
    );

    if (systemProcessesSignedEvent === undefined) {
      return vectorClock;
    }

    const systemProcessesEvent = Models.Event.fromBuffer(
      systemProcessesSignedEvent.event,
    );

    const systemProcesses = Models.SystemProcesses.fromBuffer(
      systemProcessesEvent.content,
    );

    for (const process of systemProcesses.processes) {
      const otherHeadSignedEvent = head.head.get(
        Models.Process.toString(process),
      );

      if (otherHeadSignedEvent === undefined) {
        vectorClock.logicalClocks.push(Long.UZERO);
        continue;
      }

      const otherHeadEvent = Models.Event.fromBuffer(
        otherHeadSignedEvent.event,
      );

      vectorClock.logicalClocks.push(otherHeadEvent.logicalClock);
    }

    return vectorClock;
  }

  async publish(
    contentType: Models.ContentType.ContentType,
    content: Uint8Array,
    lwwElementSet: Protocol.LWWElementSet | undefined,
    lwwElement: Protocol.LWWElement | undefined,
    references: Protocol.Reference[],
  ): Promise<Models.Pointer.Pointer> {
    return await this._ingestLock.acquire(
      Models.PublicKey.toString(this._system),
      async () => {
        const processState =
          await this._store.indexProcessStates.getProcessState(
            this._system,
            this._processSecret.process,
          );

        const event = Models.Event.fromProto({
          system: this._system,
          process: this._processSecret.process,
          logicalClock: processState.logicalClock.add(Long.UONE).toUnsigned(),
          contentType: contentType,
          content: content,
          vectorClock: await this.publishComputeVectorClock(),
          lwwElementSet: lwwElementSet,
          lwwElement: lwwElement,
          references: references,
          indices: processState.indices,
          unixMilliseconds: Long.fromNumber(Date.now(), true),
        });

        const eventBuffer = Protocol.Event.encode(event).finish();

        const signedEvent = Models.SignedEvent.fromProto({
          signature: await Models.PrivateKey.sign(
            this._processSecret.system,
            eventBuffer,
          ),
          event: eventBuffer,
          moderationTags: [],
        });

        return await this.ingestWithoutLock(signedEvent);
      },
    );
  }

  public async ingest(
    signedEvent: Models.SignedEvent.SignedEvent,
    skipUpdateQueries = false,
  ): Promise<Models.Pointer.Pointer> {
    const event = Models.Event.fromBuffer(signedEvent.event);

    const result = await this._ingestLock.acquire(
      Models.PublicKey.toString(event.system),
      async () => {
        return await this.ingestWithoutLock(signedEvent, skipUpdateQueries);
      },
    );

    await this.updateHeadIfNeeded(signedEvent);

    return result;
  }

  private async updateHeadIfNeeded(
    signedEvent: Models.SignedEvent.SignedEvent,
  ): Promise<void> {
    const event = Models.Event.fromBuffer(signedEvent.event);

    if (
      !Models.PublicKey.equal(event.system, this.system()) ||
      Models.Process.equal(event.process, this.process())
    ) {
      return;
    }

    const head = await RXJS.firstValueFrom(
      Queries.QueryHead.queryHeadObservable(
        this.queryManager.queryHead,
        event.system,
      ).pipe(
        RXJS.switchMap((head) => {
          if (head.attemptedSources.has('disk')) {
            return RXJS.of(head);
          } else {
            return RXJS.NEVER;
          }
        }),
      ),
    );

    const locallyKnownSystemProcesses = new Map<
      Models.Process.ProcessString,
      Models.Process.Process
    >();

    const allSystemProcesses = new Map<
      Models.Process.ProcessString,
      Models.Process.Process
    >();

    for (const systemProcessesSignedEvent of head.processLists.values()) {
      const systemProcessesEvent = Models.Event.fromBuffer(
        systemProcessesSignedEvent.event,
      );

      const systemProcesses = Models.SystemProcesses.fromBuffer(
        systemProcessesEvent.content,
      );

      for (const process of systemProcesses.processes) {
        allSystemProcesses.set(Models.Process.toString(process), process);
      }
    }

    for (const headSignedEvent of head.head.values()) {
      const headEvent = Models.Event.fromBuffer(headSignedEvent.event);

      allSystemProcesses.set(
        Models.Process.toString(headEvent.process),
        headEvent.process,
      );
    }

    allSystemProcesses.delete(Models.Process.toString(this.process()));

    {
      const systemProcessesSignedEvent = head.processLists.get(
        Models.Process.toString(this.process()),
      );

      if (systemProcessesSignedEvent) {
        const systemProcessesEvent = Models.Event.fromBuffer(
          systemProcessesSignedEvent.event,
        );

        const systemProcesses = Models.SystemProcesses.fromBuffer(
          systemProcessesEvent.content,
        );

        for (const process of systemProcesses.processes) {
          locallyKnownSystemProcesses.set(
            Models.Process.toString(process),
            process,
          );
        }
      }
    }

    if (
      allSystemProcesses.size === 0 ||
      Util.areMapsEqual(
        locallyKnownSystemProcesses,
        allSystemProcesses,
        Models.Process.equal,
      )
    ) {
      return;
    }

    const updatedSystemProcesses = Models.SystemProcesses.fromProto({
      processes: Array.from(allSystemProcesses.values()),
    });

    await this.publish(
      Models.ContentType.ContentTypeSystemProcesses,
      Protocol.SystemProcesses.encode(updatedSystemProcesses).finish(),
      undefined,
      undefined,
      [],
    );
  }

  private getEventKey(event: Protocol.Event): string {
    if (!event.system) {
      throw new Error('Event system is undefined');
    }
    if (!event.process) {
      throw new Error('Event process is undefined');
    }
    const systemStr = Models.PublicKey.toString(
      Models.PublicKey.fromProto(event.system),
    );
    const processStr = Models.Process.toString(
      Models.Process.fromProto(event.process),
    );
    const logicalClock = event.logicalClock.toString();

    // Create a consistent key format for lookups
    return `${systemStr}_${processStr}_${logicalClock}`;
  }

  public getEventAckCount(event: Protocol.Event): number {
    // First try direct lookup
    const eventKey = this.getEventKey(event);
    const directAcks = this._eventAcks.get(eventKey)?.size ?? 0;
    if (directAcks > 0) {
      return directAcks;
    }

    // If no direct match, check for keys containing the logical clock
    const logicalClockStr = event.logicalClock.toString();
    let count = 0;

    for (const [key, servers] of this._eventAcks.entries()) {
      // Look for keys that might match this event based on logical clock
      if (key.includes(logicalClockStr)) {
        count = Math.max(count, servers.size);
      }
    }

    return count;
  }

  public getEventAcks(event: Protocol.Event): Set<string> {
    const eventKey = this.getEventKey(event);
    return new Set(this._eventAcks.get(eventKey) ?? []);
  }

  public getEventAckServers(event: Protocol.Event): string[] {
    // Try direct lookup first
    const lookupKey = this.getEventKey(event);
    const directAcks = this._eventAcks.get(lookupKey);
    if (directAcks && directAcks.size > 0) {
      return Array.from(directAcks);
    }

    // Check for the logical clock in any key
    const logicalClockStr = event.logicalClock.toString();
    const result = new Set(['local']);

    // Check all stored acknowledgments for this logical clock
    for (const [key, servers] of this._eventAcks.entries()) {
      if (key.includes(logicalClockStr)) {
        for (const server of servers) {
          result.add(server);
        }
      }
    }

    // If we have external servers, return all of them
    const external = Array.from(result).filter((s) => s !== 'local');
    if (external.length > 0) {
      return Array.from(result);
    }

    // Default to just local if no external servers found
    return ['local'];
  }

  public subscribeToEventAcks(
    event: Protocol.Event,
    callback: (serverId: string) => void,
  ): () => void {
    const eventKey = this.getEventKey(event);

    let subscribers = this._eventAckSubscriptions.get(eventKey);
    if (!subscribers) {
      subscribers = new Set();
      this._eventAckSubscriptions.set(eventKey, subscribers);
    }

    subscribers.add(callback);

    return () => {
      const subs = this._eventAckSubscriptions.get(eventKey);
      if (subs) {
        subs.delete(callback);
      }
    };
  }

  private async ingestWithoutLock(
    signedEvent: Models.SignedEvent.SignedEvent,
    skipUpdateQueries = false,
  ): Promise<Models.Pointer.Pointer> {
    await this._store.ingest(signedEvent);

    const event = Models.Event.fromBuffer(signedEvent.event);
    const eventKey = this.getEventKey(event);

    let acks = this._eventAcks.get(eventKey);
    if (!acks) {
      acks = new Set<string>();
      this._eventAcks.set(eventKey, acks);
    }

    const serverId = 'local';
    if (!acks.has(serverId)) {
      acks.add(serverId);

      const subscribers = this._eventAckSubscriptions.get(eventKey);
      if (subscribers) {
        for (const callback of subscribers) {
          callback(serverId);
        }
      }
    }

    if (this._listener) {
      this._listener(signedEvent);
    }

    if (!skipUpdateQueries) {
      this.queryManager.update(signedEvent);
    }

    if (Models.PublicKey.equal(event.system, this.system())) {
      void this.synchronizer.synchronizationHint();
    }

    return Models.signedEventToPointer(signedEvent);
  }

  private async getCurrentSignedServerEvents(): Promise<
    Models.SignedEvent.SignedEvent[]
  > {
    return new Promise((resolve) => {
      const handle = this.queryManager.queryCRDTSet.query(
        this.system(),
        Models.ContentType.ContentTypeServer,
        (state) => {
          const serverCellList = Queries.QueryIndex.applyPatch([], state);
          const signedServerEvents = serverCellList
            .map((cell) => cell.signedEvent)
            .filter(
              (e): e is Models.SignedEvent.SignedEvent => e !== undefined,
            );

          setTimeout(() => {
            handle.unregister();
            resolve(signedServerEvents);
          }, 0);
        },
      );
      handle.advance(100);
    });
  }

  async createExportBundle(): Promise<Protocol.ExportBundle> {
    const signedServerEvents = await this.getCurrentSignedServerEvents();

    const keyPair = {
      keyType: this.processSecret().system.keyType,
      privateKey: this.processSecret().system.key,
      publicKey: this.system().key,
    };

    return {
      keyPair: keyPair,
      events: {
        events: [...signedServerEvents],
      },
    };
  }

  public recordServerAck(event: Protocol.SignedEvent, serverId: string): void {
    const eventData = event.event;
    if (typeof eventData === 'undefined') return;

    const decodedEvent = Protocol.Event.decode(eventData);
    if (
      typeof decodedEvent.system === 'undefined' ||
      typeof decodedEvent.process === 'undefined' ||
      typeof decodedEvent.logicalClock === 'undefined'
    ) {
      return;
    }

    const eventKey = this.getEventKey(decodedEvent);

    let acks = this._eventAcks.get(eventKey);
    if (!acks) {
      acks = new Set<string>();
      this._eventAcks.set(eventKey, acks);
    }

    if (!acks.has(serverId) && serverId !== 'local') {
      acks.add(serverId);

      void this._store.indexEvents.saveEventAcks(
        Models.PublicKey.fromProto(decodedEvent.system),
        Models.Process.fromProto(decodedEvent.process),
        decodedEvent.logicalClock,
        Array.from(acks),
      );

      const subscribers = this._eventAckSubscriptions.get(eventKey);
      if (subscribers) {
        for (const callback of subscribers) {
          callback(serverId);
        }
      }
    }
  }

  public getAllEventAcks(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const [key, servers] of this._eventAcks.entries()) {
      result[key] = Array.from(servers);
    }
    return result;
  }
}

export async function solveChallenge(
  processHandle: ProcessHandle,
  challenge: Readonly<Protocol.HarborChallengeResponse>,
): Promise<Protocol.HarborValidateRequest> {
  const challengeBody = Protocol.HarborChallengeResponseBody.decode(
    challenge.body,
  );

  return {
    challenge: challenge,
    system: processHandle.system(),
    signature: await Models.PrivateKey.sign(
      processHandle.processSecret().system,
      challengeBody.challenge,
    ),
  };
}

export async function createProcessHandle(
  metaStore: MetaStore.IMetaStore,
): Promise<ProcessHandle> {
  const privateKey = Models.PrivateKey.random();
  const publicKey = await Models.PrivateKey.derivePublicKey(privateKey);
  const process = Models.Process.random();

  const level = await metaStore.openStore(publicKey, 0);

  const processSecret = Models.ProcessSecret.fromProto({
    system: privateKey,
    process: process,
  });

  const store = new Store.Store(level);

  await store.setProcessSecret(processSecret);

  await metaStore.setStoreReady(publicKey, 0);

  return ProcessHandle.load(store);
}

export async function createProcessHandleFromKey(
  metaStore: MetaStore.IMetaStore,
  privateKey: Models.PrivateKey.PrivateKey,
): Promise<ProcessHandle> {
  const publicKey = await Models.PrivateKey.derivePublicKey(privateKey);
  const process = Models.Process.random();
  const level = await metaStore.openStore(publicKey, 0);

  const processSecret = Models.ProcessSecret.fromProto({
    system: privateKey,
    process: process,
  });

  const store = new Store.Store(level);
  await store.setProcessSecret(processSecret);
  await metaStore.setStoreReady(publicKey, 0);
  return ProcessHandle.load(store);
}

export async function makeEventLink(
  handle: ProcessHandle,
  system: Models.PublicKey.PublicKey,
  event: Models.Pointer.Pointer,
): Promise<string> {
  const state = await handle.loadSystemState(system);

  return makeEventLinkSync(event, state.servers());
}

export function makeEventLinkSync(
  event: Models.Pointer.Pointer,
  servers: string[],
): string {
  return Base64.encodeUrl(
    Protocol.URLInfo.encode({
      urlType: Models.URLInfo.URLInfoTypeEventLink,
      body: Protocol.URLInfoEventLink.encode({
        system: event.system,
        process: event.process,
        logicalClock: event.logicalClock,
        servers: servers,
      }).finish(),
    }).finish(),
  );
}

export async function makeSystemLink(
  handle: ProcessHandle,
  system: Models.PublicKey.PublicKey,
): Promise<string> {
  const state = await handle.loadSystemState(system);

  return makeSystemLinkSync(system, state.servers());
}

export function makeSystemLinkSync(
  system: Models.PublicKey.PublicKey,
  servers: string[],
): string {
  return Base64.encodeUrl(
    Protocol.URLInfo.encode({
      urlType: Models.URLInfo.URLInfoTypeSystemLink,
      body: Protocol.URLInfoSystemLink.encode({
        system: system,
        servers: servers,
      }).finish(),
    }).finish(),
  );
}

export async function createTestProcessHandle(): Promise<ProcessHandle> {
  return await createProcessHandle(
    await MetaStore.createMetaStore(
      PersistenceDriver.createPersistenceDriverMemory(),
    ),
  );
}

export async function testProcessHandleCreateNewProcess(
  processHandle: ProcessHandle,
): Promise<ProcessHandle> {
  return await createProcessHandleFromKey(
    await MetaStore.createMetaStore(
      PersistenceDriver.createPersistenceDriverMemory(),
    ),
    processHandle.processSecret().system,
  );
}

export async function fullSync(handle: ProcessHandle) {
  while (await Synchronization.backFillServers(handle, handle.system())) {}
}

export const TEST_SERVER = 'http://127.0.0.1:8081';

export async function copyEventBetweenHandles(
  pointer: Models.Pointer.Pointer,
  from: ProcessHandle,
  to: ProcessHandle,
): Promise<void> {
  const signedEvent = await from
    .store()
    .indexEvents.getSignedEvent(
      pointer.system,
      pointer.process,
      pointer.logicalClock,
    );

  if (signedEvent === undefined) {
    throw new Error('expected signedEvent');
  }

  await to.ingest(signedEvent);
}
