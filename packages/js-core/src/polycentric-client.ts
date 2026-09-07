import {
  ClientState,
  ContentManager,
  EventService,
  HydrationStatus,
  IdentityManager,
  InitializationStep,
  KeyPairManager,
  PairingSessionManager,
} from './client-internal';
import {
  COLLECTION,
  KEY_TYPE,
  SyncStrategy,
  type Collection,
} from './constants';
import { sha256 } from '@noble/hashes/sha2.js';
import type {
  ICryptoManager,
  IFileStoreDriver,
  IStorageDriver,
} from './platform-interfaces';
import * as Proto from './proto/v2';
import { StorageHandle } from './datastore/storage-handle';
import { toDigestKey } from './utils/hex';
import { CryptoManager } from './crypto/crypto-manager';
import { createServerJwt, DEFAULT_EXPIRY_SECONDS } from './crypto/server-jwt';

import type { PolycentricCoreLike, EventKey } from '@polycentric/rs-core-wasm';
// `./generated` is the pure-JS bindings subpath; it exposes the Query
// class and QueryStatus enum without dragging in the wasm asset. The
// uniffi runtime that backs these (`uniffi-bindgen-react-native`) is
// externalised in webpack.config.js so consumers resolve it at runtime.
import { Query, QueryStatus } from '@polycentric/rs-core-wasm/generated';

type CoreType = PolycentricCoreLike;

export type {
  IdentityState,
  PublishArgs,
  IdentityUpdate,
} from './client-internal/identity-manager';

/** Private key — same shape as PublicKey, holds the secret key bytes. */
export interface PrivateKey {
  keyType: Proto.KeyType;
  key: Uint8Array;
}

export interface KeyPair {
  keyType: Proto.KeyType;
  privateKey: PrivateKey;
  publicKey: Proto.PublicKey;
}

/**
 * PolycentricClientConfig defines the dependencies and configuration for a PolycentricClient.
 */
export interface PolycentricClientConfig {
  /**
   * The uniffi-generated `PolycentricCore` instance from
   * `@polycentric/react-native`. Owns crypto, local stores, image
   * processing, and gRPC client transport.
   */
  core: CoreType;
  storageDriver: IStorageDriver;
  filestoreDriver: IFileStoreDriver;
  /**
   * gRPC-web URLs the client should start with. Used to seed
   * `client.servers` before `initialize()` fetches each server's
   * `ServerInfo`.
   */
  seedServers?: string[];
  /**
   * False when the storage drivers do not survive a restart (e.g. the
   * in-memory fallback used when private browsing blocks IndexedDB).
   * UIs should not offer identity creation/pairing in that case.
   */
  persistentStorage?: boolean;
  /** Stamped on every event this client builds. */
  application?: Proto.Application;
}

/**
 * PolycentricClient is the top level API for the Polycentric SDK.
 */
export class PolycentricClient {
  public readonly events = new EventService();

  public readonly keyPairManager = new KeyPairManager(this);
  public readonly contentManager = new ContentManager(this);
  public readonly identityManager = new IdentityManager(this);
  public readonly pairingSessionManager = new PairingSessionManager(this);

  private state = ClientState.UNINITIALIZED;
  public step = '';
  public hydrationStatus: HydrationStatus = HydrationStatus.NOT_STARTED;
  public error: Error | null = null;

  public readonly core: CoreType;

  public currentKeyPair: KeyPair | null = null;
  /** The identity key the current key pair is actively using. Set by publishIdentity or claimIdentity. */
  public activeIdentityKey: string | null = null;
  public servers: string[] = ['http://localhost:3000'];

  public readonly cryptoManager: ICryptoManager = new CryptoManager();

  public storageHandle: StorageHandle | undefined;
  public readonly storageDriver: IStorageDriver;
  public readonly filestoreDriver: IFileStoreDriver;
  public readonly persistentStorage: boolean;
  public readonly application: Proto.Application | undefined;

  constructor(config: PolycentricClientConfig) {
    this.core = config.core;
    this.storageDriver = config.storageDriver;
    this.filestoreDriver = config.filestoreDriver;
    this.persistentStorage = config.persistentStorage ?? true;
    this.application = config.application;
    if (config.seedServers && config.seedServers.length > 0) {
      this.servers = [...config.seedServers];
    }

    // Authenticate every outgoing gRPC request as the active identity. The
    // core caches each server's token and only calls back when it expires.
    this.core.setAuthTokenProvider({
      authToken: async (serverUrl: string) => {
        if (!this.currentKeyPair || !this.activeIdentityKey) {
          return undefined;
        }
        const token = await createServerJwt({
          keyPair: this.currentKeyPair,
          iss: this.activeIdentityKey,
          aud: serverUrl,
        });
        return {
          token,
          expiresAt: BigInt(
            Math.floor(Date.now() / 1000) + DEFAULT_EXPIRY_SECONDS,
          ),
        };
      },
    });
  }

  public static async create(
    config: PolycentricClientConfig,
  ): Promise<PolycentricClient> {
    const client = new PolycentricClient(config);
    await client.initialize();
    return client;
  }

  private async initialize() {
    try {
      this.setState(ClientState.INITIALIZING);
      this.setStep(InitializationStep.STARTING);

      this.setStep(InitializationStep.INITIALIZING_CORE);

      this.setStep(InitializationStep.SETTING_UP_STORAGE);
      this.storageHandle = new StorageHandle({
        eventRepository: this.storageDriver.createEventRepository(),
        contentRepository: this.storageDriver.createContentRepository(),
        keysRepository: this.storageDriver.createKeysRepository(),
        eventAckRepository: this.storageDriver.createEventAckRepository(),
      });

      this.setStep(InitializationStep.LOADING_PROCESS_ID);

      this.setStep(InitializationStep.HYDRATING_EVENTS);

      await this.copyEvents();
      await this.copyContents();

      this.setHydrationStatus(HydrationStatus.COMPLETED);

      const restoredIdentity = await this.restoreKeyPair();

      // SDK should always make a new keypair if we can't find any
      if (!restoredIdentity) {
        this.setStep(InitializationStep.CREATING_EPHEMERAL_IDENTITY);
        await this.keyPairManager.createKeyPair({
          keyType: KEY_TYPE.ED25519,
          setAsCurrent: true,
        });
      }

      // Push the JS-side server list into the rust core so that
      // observables that fan out to every configured server (e.g.
      // `getIdentityFeed`) actually have somewhere to call.
      await this.refreshServers();

      this.setStep(InitializationStep.COMPLETE);
      this.setState(ClientState.READY);
    } catch (error) {
      this.setError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /** Blob URL for each configured server, in order, for fallback. */
  blobUrls(digest: Proto.ContentDigest): string[] {
    const key = toDigestKey(digest);
    return this.servers.map((server) => `${server}/blob/${key}`);
  }

  /** First server's blob URL, or `null` if no servers are configured. */
  blobUrl(digest: Proto.ContentDigest): string | null {
    return this.blobUrls(digest)[0] ?? null;
  }

  /**
   * Proxy a remote image through each server's `/image_proxy` endpoint, in
   * order, for fallback. Used for link-preview thumbnails so the client never
   * hotlinks third-party hosts (avoids leaking reader IPs and
   * mixed-content/CORS issues).
   */
  imageProxyUrls(imageUrl: string): string[] {
    const q = encodeURIComponent(imageUrl);
    return this.servers.map((server) => `${server}/image_proxy?url=${q}`);
  }

  /** First server's image-proxy URL, or `null` if no servers are configured. */
  imageProxyUrl(imageUrl: string): string | null {
    return this.imageProxyUrls(imageUrl)[0] ?? null;
  }

  /**
   * Fetch link-preview metadata for `url` from the configured servers'
   * unfurl endpoint (`ContentService.UrlInfo`). Tries each server in turn
   * and returns the first successful `Link`; returns `null` if every server
   * fails.
   */
  async urlInfo(url: string): Promise<Proto.UrlInfoResponse | null> {
    for (const server of this.servers) {
      try {
        const bytes = await this.core.urlInfo(server, url);
        return Proto.UrlInfoResponse.fromBinary(new Uint8Array(bytes));
      } catch {
        // Try the next server.
      }
    }
    return null;
  }

  /**
   * Ban or unban `targetIdentity` on `server`
   * (`IdentityService.SetBanStatus`). The active identity must be a
   * moderator on `server`.
   */
  async setBanStatus(
    server: string,
    targetIdentity: string,
    banned: boolean,
  ): Promise<void> {
    const body = Proto.SetBanStatusRequest.toBinary(
      Proto.SetBanStatusRequest.create({ targetIdentity, banned }),
    );
    await this.core.setBanStatus(server, body.buffer as ArrayBuffer);
  }

  /**
   * Looks at existing keys and will pick the first one
   */
  private async restoreKeyPair(): Promise<boolean> {
    const identities = await this.keyPairManager.getKeys();
    const identity = identities[0];

    if (!identity) {
      return false;
    }

    await this.setCurrentKeyPair(identity);
    return true;
  }

  /**
   * Hydrate the Rust core's in-memory stores from persistent storage.
   * The Rust stores are ephemeral (reset on every load) so anything the
   * core needs (events for clocks/sequences, content for identity lookups)
   * must be copied in at startup.
   */
  async copyEvents(events?: Proto.SignedEvent[]) {
    const signedEvents = events ?? (await this.storage.events.getAll());

    this.core.copyEvents(
      signedEvents.map(
        (s) => Proto.SignedEvent.toBinary(s).buffer as ArrayBuffer,
      ),
    );
  }

  /**
   * A temporary function to copy all the content the browser is aware of.
   * We should make this smarter with the EventBundles, maybe.
   */
  async copyContents(
    contents?: { digest: Proto.ContentDigest; content: Proto.Content }[],
  ) {
    const list = contents ?? (await this.storage.content.getAll());

    this.core.copyContents(
      list.map((r) => ({
        digestBytes: Proto.ContentDigest.toBinary(r.digest)
          .buffer as ArrayBuffer,
        contentBytes: Proto.Content.toBinary(r.content).buffer as ArrayBuffer,
      })),
    );
  }

  /**
   * Helper function build an Event from a Content.
   * Uses the current keypair and current identity.
   */
  async buildEvent(
    content: Proto.Content,
    collection: Collection | number = COLLECTION.FEED,
  ): Promise<Proto.Event> {
    if (!this.currentKeyPair) {
      throw new Error('No keypair set');
    }

    if (!this.activeIdentityKey) {
      throw new Error('No active identity');
    }

    const sequence = this.core.nextSequence(this.activeIdentityKey, collection);

    // identity_sequence must reference an identity event signed by the
    // current keypair.
    const identitySequence =
      collection === COLLECTION.IDENTITY
        ? sequence
        : this.core.getIdentitySequence(
            this.activeIdentityKey,
            Proto.PublicKey.toBinary(this.currentKeyPair.publicKey)
              .buffer as ArrayBuffer,
          );

    if (!identitySequence) {
      throw new Error(
        'Cannot build event: current keypair has no identity event for the active identity (broken pairing?)',
      );
    }

    const previousSignature = new Uint8Array(
      this.core.previousSignature(this.activeIdentityKey, collection),
    );
    const previousRoot = new Uint8Array(
      this.core.previousRoot(this.activeIdentityKey, collection),
    );

    const event = Proto.Event.create({
      key: Proto.EventKey.create({
        collection,
        identity: this.activeIdentityKey,
        signedBy: this.currentKeyPair.publicKey,
        sequence,
      }),
      identitySequence,
      previousSignature,
      previousRoot,
      contentDigest: this.contentManager.buildDigest(content),
      createdAt: BigInt(Date.now()),
      application: this.application,
    });

    const identityContentForVC =
      collection === COLLECTION.IDENTITY &&
      content.contentBody.oneofKind === 'identity'
        ? content.contentBody.identity
        : undefined;
    event.vectorClock = this.buildVectorClock(event, identityContentForVC);

    return event;
  }

  /**
   * Sign an event with the current key pair.
   */
  async signEvent(event: Proto.Event): Promise<Proto.SignedEvent> {
    const eventBytes = Proto.Event.toBinary(event);

    const signedEventBytes = await this.core.signEvent(
      eventBytes.buffer as ArrayBuffer,
      {
        sign: async (bytes: ArrayBuffer): Promise<ArrayBuffer> => {
          if (!this.currentKeyPair) {
            throw new Error('No keypair');
          }
          const signature = await this.crypto.sign(
            this.currentKeyPair.privateKey.key,
            new Uint8Array(bytes),
            this.currentKeyPair.keyType,
          );
          return signature.buffer.slice(
            signature.byteOffset,
            signature.byteOffset + signature.byteLength,
          ) as ArrayBuffer;
        },
      },
    );
    return Proto.SignedEvent.fromBinary(new Uint8Array(signedEventBytes));
  }

  /**
   * Sign and persist a v2 Event.
   *
   * Mirrors the event (and its content, if supplied) into the Rust core so
   * subsequent `build_vector_clock` / `next_sequence` calls see it.
   */
  async commitEvent(
    signedEvent: Proto.SignedEvent,
    content?: Proto.Content,
  ): Promise<void> {
    await this.storage.events.save(signedEvent);

    this.core.copyEvents([
      Proto.SignedEvent.toBinary(signedEvent).buffer as ArrayBuffer,
    ]);

    if (content) {
      const event = Proto.Event.fromBinary(signedEvent.eventBytes);
      if (event.contentDigest) {
        this.core.copyContents([
          {
            digestBytes: Proto.ContentDigest.toBinary(event.contentDigest)
              .buffer as ArrayBuffer,
            contentBytes: Proto.Content.toBinary(content).buffer as ArrayBuffer,
          },
        ]);
      }
    }

    this.events.emitContentCreated({ signedEvent, content });
  }

  /**
   * Build a vector clock for a single collection within an identity.
   *
   * Delegates to the Rust core, which resolves the referenced identity
   * document from its local content store and computes the clock.
   * Requires the identity event and its content to already have been
   * copied into the core via `copy_events` / `copy_contents`.
   */
  buildVectorClock(
    event: Proto.Event,
    identityContent?: Proto.Identity,
  ): Proto.VectorClock {
    const clockBytes = this.core.buildVectorClock(
      event.key!.identity,
      event.key!.collection,
      event.identitySequence,
      Proto.PublicKey.toBinary(event.key!.signedBy!).buffer as ArrayBuffer,
      event.key!.sequence,
      identityContent
        ? (Proto.Identity.toBinary(identityContent).buffer as ArrayBuffer)
        : undefined,
    );
    return Proto.VectorClock.fromBinary(new Uint8Array(clockBytes));
  }

  /**
   * Generic query wrapper around `core.listEvents`. Subscribes to the
   * fan-out observable, accumulates `event_bundles` from each
   * per-server emission, and resolves once the observable completes.
   * Does not persist — callers decide what to do with the response.
   */
  async listEvents(options?: {
    limit?: number | null;
    identity?: string | null;
    collection?: number | null;
    signedBy?: Proto.PublicKey | null;
    /** Exclusive lower bound on EventKey.sequence. */
    sequenceGt?: number | bigint | null;
    /** Exclusive upper bound on EventKey.sequence. */
    sequenceLt?: number | bigint | null;
    heads?: Proto.EventKey[] | null;
    queryKey?: string[] | null;
  }): Promise<Proto.EventBundle[]> {
    const sequenceGt =
      options?.sequenceGt != null ? BigInt(options.sequenceGt) : undefined;
    const sequenceLt =
      options?.sequenceLt != null ? BigInt(options.sequenceLt) : undefined;

    // `signedBy.key` is a Uint8Array view into the wire-decoded
    // message buffer (protobuf-ts uses subarray). `.buffer` would be
    // the whole message buffer, not just the key bytes — copy through
    // `.slice()` so the FFI receives exactly the public-key bytes.
    const signedBy = options?.signedBy
      ? {
          keyType: options.signedBy.keyType,
          key: options.signedBy.key.slice().buffer as ArrayBuffer,
        }
      : undefined;

    const heads = this.getFilterHeads(options?.heads ?? []);

    return new Promise<Proto.EventBundle[]>((resolve, reject) => {
      const observable = this.core.fetchQuery(
        options?.queryKey ?? undefined,
        new Query.ListEvents({
          size: options?.limit ?? undefined,
          identity: options?.identity ?? undefined,
          collection: options?.collection ?? undefined,
          signedBy,
          sequenceGt,
          sequenceLt,
          heads,
        }),
        undefined,
      );

      let latest: Proto.EventBundle[] = [];
      // Observable never `complete()`s — resolve on the Loading→Success
      // transition once every server slot has reported.
      const subscription = observable.subscribe({
        next: (result) => {
          if (result.data) {
            const response = Proto.ListEventsResponse.fromBinary(
              new Uint8Array(result.data),
            );
            latest = response.eventBundles;
          }
          if (result.status === QueryStatus.Success) {
            subscription.unsubscribe();
            resolve(latest);
          }
        },
        error: (message: string) => {
          subscription.unsubscribe();
          reject(new Error(message));
        },
        complete: () => {},
      });
    });
  }

  /** Convert to FFI types */
  private getFilterHeads(heads: Proto.EventKey[]): EventKey[] {
    const out: EventKey[] = [];

    for (const head of heads) {
      if (!head.signedBy) continue;

      out.push({
        collection: head.collection,
        identity: head.identity,
        signedBy: {
          keyType: head.signedBy.keyType,
          key: head.signedBy.key.slice().buffer as ArrayBuffer,
        },
        sequence: head.sequence,
      });
    }

    return out;
  }

  /**
   * Return non-deleted event bundles for an `(identity, collection)` stream
   * from the local core. Tombstone CRDT is applied by the core: any event
   * targeted by a `Delete` content in the same collection is excluded.
   * Content-type filtering is left to the caller.
   *
   * Requires the core to be hydrated — e.g. client initialization (which
   * replays from local storage) and optionally `sync()` to pull new events
   * from servers.
   */
  listValidEvents(identity: string, collection: number): Proto.EventBundle[] {
    const bytes = this.core.listValidEvents(identity, collection);
    return Proto.ListEventsResponse.fromBinary(new Uint8Array(bytes))
      .eventBundles;
  }

  /**
   * Identities the active identity blocks, derived from local block events.
   */
  blockedIdentities(): string[] {
    return this.core.blockedIdentities();
  }

  /**
   * The canonical identity chain for `identity` as bundles.
   */
  resolveIdentityChain(identity: string): Proto.EventBundle[] {
    const bytes = this.core.resolveIdentityChain(identity);
    const response = Proto.ListEventsResponse.fromBinary(new Uint8Array(bytes));
    return response.eventBundles;
  }

  /**
   * Decode an image, resize into `width` x `height` per `mode`, and
   * encode as JPEG via the core. Returns the JPEG bytes plus the
   * actual output dimensions.
   *
   * - `"fill"` (default): scale + center-crop, output is exactly `width` x `height`.
   * - `"fit"`: preserve aspect ratio, output fits inside `width` x `height`.
   */
  processImageToJpeg(
    image: Uint8Array,
    width: number,
    height: number,
    mode: 'fill' | 'fit' = 'fill',
  ): { bytes: Uint8Array; width: number; height: number } {
    const result = this.core.processImageToJpeg(
      image.buffer as ArrayBuffer,
      width,
      height,
      mode,
    );
    return {
      bytes: new Uint8Array(result.bytes),
      width: result.width,
      height: result.height,
    };
  }

  /**
   * Sign a `RegisterPushNotificationRequest` with the active key pair and
   * deliver it to every configured server via gRPC-web. Per-server failures
   * are logged but do not throw — registration is best-effort across the
   * server set.
   */
  async registerPushNotifications(
    servers: string[],
    request: Proto.RegisterPushNotificationRequest,
  ): Promise<void> {
    if (!this.currentKeyPair) {
      throw new Error('registerPushNotifications requires an active key pair');
    }

    const messageBytes =
      Proto.RegisterPushNotificationRequest.toBinary(request);
    const signature = await this.crypto.sign(
      this.currentKeyPair.privateKey.key,
      messageBytes,
      this.currentKeyPair.keyType,
    );
    const signedMessageBytes = Proto.SignedMessage.toBinary(
      Proto.SignedMessage.create({
        publicKey: this.currentKeyPair.publicKey,
        signature,
        messageBytes,
      }),
    );

    const results = await Promise.allSettled(
      servers.map((server) =>
        this.core.registerPushNotifications(
          server,
          signedMessageBytes.buffer as ArrayBuffer,
        ),
      ),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(
          'registerPushNotifications failed for a server:',
          result.reason,
        );
      }
    }
  }

  /**
   * Hash `bytes` and save to the local filestore. Returns the matching
   * `Blob` proto. Does not upload to servers.
   */
  async commitBlob(bytes: Uint8Array, mimeType: string): Promise<Proto.Blob> {
    const digest: Proto.ContentDigest = {
      type: Proto.ContentDigestType.SHA256,
      value: sha256(bytes),
    };
    await this.filestoreDriver.put(digest, bytes);
    return Proto.Blob.create({
      digest,
      mimeType,
      size: BigInt(bytes.length),
    });
  }

  /**
   * Fetch a blob body by digest, trying each server in turn.
   * Returns null if none serve it.
   */
  async fetchBlobBytes(
    digest: Proto.ContentDigest,
  ): Promise<Uint8Array | null> {
    for (const url of this.blobUrls(digest)) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        return new Uint8Array(await res.arrayBuffer());
      } catch {
        // try next server
      }
    }
    return null;
  }

  /**
   * Upload a blob body to all configured servers. The server verifies
   * that `body` hashes to `blob.digest` before persisting. Rejections
   * from individual servers are logged but do not throw.
   */
  async uploadBlob(
    blob: Proto.Blob,
    body: Uint8Array,
    servers?: string[],
  ): Promise<void> {
    servers = servers ?? this.servers;

    const requestBytes = Proto.UploadBlobRequest.toBinary(
      Proto.UploadBlobRequest.create({ blob, body }),
    );

    const results = await Promise.allSettled(
      servers.map((server) =>
        this.core.uploadBlob(server, requestBytes.buffer as ArrayBuffer),
      ),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('uploadBlob failed for a server:', result.reason);
      }
    }
  }

  /**
   * Pull signed events for the active identity from all configured servers
   * and persist new ones locally. Existing events/content are not overwritten.
   *
   * @returns The number of new events persisted
   */
  private async pull(partial: boolean): Promise<number> {
    if (!this.activeIdentityKey) throw new Error('No active identity');
    const identity = this.activeIdentityKey;

    // Only filter by heads when doing a partial pull
    let heads: Proto.EventKey[] | undefined;

    if (partial) {
      // Partial pulls will skip events at or before each event stream head.
      // Find each head event and then map it to the filter format.
      const headEvents = await this.storage.events.getByIdentity(identity, {
        headsOnly: true,
      });
      heads = headEvents
        .map((signedEvent) => {
          const event = Proto.Event.fromBinary(signedEvent.eventBytes);
          return event.key;
        })
        .filter((head): head is Proto.EventKey => !!head);
    }

    // Fetch new bundles from server
    const bundles = await this.listEvents({
      identity,
      heads,
    });

    // Collect blobs referenced by the events
    let blobs: Proto.Blob[] = [];

    // Save new events and content
    let newCount = 0;
    for (const bundle of bundles) {
      const isNew = await this.trySaveBundle(bundle, blobs);
      if (isNew) newCount++;
    }

    // Remove duplicate blobs
    const blobMap: Map<string, Proto.Blob> = new Map();

    for (const blob of blobs) {
      if (!blob.digest) continue;
      blobMap.set(toDigestKey(blob.digest), blob);
    }

    blobs = [...blobMap.values()];

    // Catch any of our own referenced blobs so they persist locally.
    await this.contentManager.pullBlobs(blobs);
    return newCount;
  }

  /**
   * Absorb errors and return true only when the event is new and added.
   * Any discovered blobs are added to `blobs`.
   */
  private async trySaveBundle(
    bundle: Proto.EventBundle,
    blobs: Proto.Blob[],
  ): Promise<boolean> {
    try {
      if (!bundle.signedEvent) return false;

      const bytes = bundle.signedEvent.eventBytes;

      const event = Proto.Event.fromBinary(bytes);
      if (!event.key) return false;
      if (!event.key.signedBy) return false;

      // Try saving content for any event that seems valid, even if it may already exist.
      await this.trySaveContent(event, bundle, blobs);

      const existing = await this.storage.events.getByEventKey(event.key);
      if (existing) return false;

      await this.storage.events.save(bundle.signedEvent);
      return true;
    } catch (e) {
      console.warn('Pull event:', e);
      return false;
    }
  }

  /**
   * Absorb errors and return true only when the content is new and added
   * Any discovered blobs are added to `blobs`.
   */
  private async trySaveContent(
    event: Proto.Event,
    bundle: Proto.EventBundle,
    blobs: Proto.Blob[],
  ): Promise<boolean> {
    try {
      const bytes = bundle.serializedContent?.contentBytes;
      if (!bytes) return false;

      const content = Proto.Content.fromBinary(bytes);

      const digest = event.contentDigest;
      if (!digest) return false;

      // Try finding blobs before checking content existence,
      // since we might be missing a blob referenced by content
      // that we already have.
      blobs.push(...ContentManager.collectBlobs(content));

      const existing = await this.storage.content.get(digest);
      if (existing) return false;

      await this.storage.content.save(digest, content);
      return true;
    } catch (e) {
      console.warn('Pull event content:', e);
      return false;
    }
  }

  /** Used for syncing */
  private getPullFn(strategy: SyncStrategy): () => Promise<number> {
    switch (strategy) {
      case SyncStrategy.FULL:
      case SyncStrategy.FULL_PULL:
        return () => this.pull(false);
      case SyncStrategy.PARTIAL:
      case SyncStrategy.PARTIAL_PULL:
        return () => this.pull(true);
      case SyncStrategy.FULL_PUSH:
      case SyncStrategy.PARTIAL_PUSH:
        return async () => 0;
    }
  }

  /** Used for syncing */
  private getPushFn(
    strategy: SyncStrategy,
    identity: string,
  ): (server: string) => Promise<ArrayBuffer | undefined> {
    switch (strategy) {
      case SyncStrategy.FULL:
      case SyncStrategy.FULL_PUSH:
        return (server) => this.core.pushLocalEvents(identity, server, false);
      case SyncStrategy.PARTIAL:
      case SyncStrategy.PARTIAL_PUSH:
        return (server) => this.core.pushLocalEvents(identity, server, true);
      case SyncStrategy.FULL_PULL:
      case SyncStrategy.PARTIAL_PULL:
        return async () => undefined;
    }
  }

  /**
   * Sync events for the active identity between this client and
   * the remote servers. Throws only if the pull fails.
   * @returns The number of new events pulled
   */
  async sync(strategy?: SyncStrategy): Promise<number> {
    const identity = this.activeIdentityKey;
    if (!identity) return 0;

    strategy = strategy ?? SyncStrategy.PARTIAL;

    const pullFn = this.getPullFn(strategy);
    const pushFn = this.getPushFn(strategy, identity);

    // Pull concurrently with pushing new events and blobs
    const pullTask = pullFn();

    // Push new events and blobs to servers
    const pushTasks = this.servers.map(async (server): Promise<void> => {
      const responseBytes = await pushFn(server);
      if (!responseBytes) return; // Nothing was done

      const response = Proto.PutEventsResponse.fromBinary(
        new Uint8Array(responseBytes),
      );
      const blobs = response.requestedBlobs;

      for (const error of response.errors) {
        console.error('Error from event push:', error);
      }

      await Promise.allSettled(
        blobs.map(async (blob) => {
          if (!blob.digest) return;

          const blobData = await this.filestoreDriver.get(blob.digest);
          if (!blobData) return;

          await this.uploadBlob(blob, blobData, [server]);
        }),
      );
    });

    const [pullResult, ...pushResults] = await Promise.allSettled([
      pullTask,
      ...pushTasks,
    ]);

    for (const result of pushResults) {
      if (result.status === 'rejected') {
        console.error('Sync failed for a server:', result.reason);
      }
    }

    if (pullResult.status === 'fulfilled') {
      return pullResult.value;
    } else {
      throw pullResult.reason;
    }
  }

  public async setCurrentKeyPair(keyPair: KeyPair): Promise<void> {
    this.currentKeyPair = keyPair;
    // Restore saved identity key for this key pair
    this.activeIdentityKey = await this.storageDriver.loadActiveIdentityKey(
      keyPair.publicKey.key,
    );
    this.core.setActiveIdentity(this.activeIdentityKey ?? undefined);
    if (this.storageHandle) {
      await this.refreshServers();
    }
  }

  /**
   * Derive `servers` from the active identity's latest Identity document.
   * Identities that have never configured a server list keep the current
   * (seed) list.
   */
  public async refreshServers(): Promise<void> {
    if (this.activeIdentityKey) {
      const state = this.identityManager.resolveIdentity();
      if (state?.servers) {
        this.servers = [...state.servers];
      }
    }
    this.core.setServers(this.servers);
  }

  /**
   * Explicitly set the active identity key and persist it.
   */
  public async setActiveIdentityKey(identityKey: string | null): Promise<void> {
    this.activeIdentityKey = identityKey;
    this.core.setActiveIdentity(identityKey ?? undefined);
    // Tokens minted for the previous identity must not be reused.
    this.core.clearAuthTokens();
    if (!this.currentKeyPair) return;
    await this.storageDriver.saveActiveIdentityKey(
      this.currentKeyPair.publicKey.key,
      identityKey,
    );
  }

  /**
   * Look up the v2 identity key bound to the given key pair locally.
   * Returns null if this device has never associated an identity with the pair.
   */
  public getIdentityKeyFor(keyPair: KeyPair): Promise<string | null> {
    return this.storageDriver.loadActiveIdentityKey(keyPair.publicKey.key);
  }

  private setState(state: ClientState) {
    this.state = state;
    this.events.emitStateChanged(state);
  }

  private setStep(step: InitializationStep) {
    this.step = step;
    this.events.emitProgress(step);
  }

  private setHydrationStatus(status: HydrationStatus) {
    this.hydrationStatus = status;
    this.events.emitHydrationStatus(status);
  }

  private setError(error: Error) {
    this.state = ClientState.ERROR;
    this.error = error;
    this.events.emitStateChanged(this.state);
    this.events.emitError(error);
  }

  get currentSystem(): Proto.PublicKey {
    return this.currentKeyPair!.publicKey;
  }

  get crypto(): ICryptoManager {
    if (!this.cryptoManager) {
      throw new Error('Crypto manager not initialized');
    }
    return this.cryptoManager;
  }

  get storage(): StorageHandle {
    if (!this.storageHandle) {
      throw new Error('Storage handle not initialized');
    }
    return this.storageHandle;
  }

  get isReady(): boolean {
    return this.state === ClientState.READY;
  }
}
