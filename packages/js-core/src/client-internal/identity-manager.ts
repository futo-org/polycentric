import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { COLLECTION, KEY_TYPE, SyncStrategy } from '../constants';
import { ServerAlreadyAddedError } from '../errors';
import type { PolycentricClient, PrivateKey } from '../polycentric-client';
import * as Proto from '../proto/v2';
import { bytesEqual } from '../utils/bytes';
import { bytesToHex } from '../utils/hex';

/**
 * Resolved identity state from the latest Identity document.
 */
export interface IdentityState {
  /** The identity key (hex-encoded sha256 of the initial Identity content) */
  identityKey: string;
  /** Rotation keys that control the identity */
  rotationKeys: Proto.PublicKey[];
  /** Signing keys authorized to sign events */
  signingKeys: Proto.PublicKey[];
  /** Bounds keeping pre-revocation events from revoked signers valid. */
  revocationBounds: Proto.RevocationBound[];
  /**
   * Servers this identity pushes to and pulls from. `null` when the
   * identity has never configured its list (clients fall back to their
   * defaults); an empty array is an intentionally empty list.
   */
  servers: string[] | null;
  /**
   * Optional recovery key for recovering access when there are no active
   * sessions. Its only use is for producing recovery signatures.
   */
  recoveryKey: Proto.PublicKey | null;
}

/**
 * Arguments for publishing an Identity document.
 * Omit the identity key to have it derived as the genesis event.
 */
export interface PublishArgs {
  identityKey?: string;
  rotationKeys: Proto.PublicKey[];
  signingKeys: Proto.PublicKey[];
  servers?: string[] | null;
  revocationBounds?: Proto.RevocationBound[];
  recoveryKey?: Proto.PublicKey | null;
  recoverySignature?: Uint8Array | null;

  /**
   * Publishing a login event like a signing key republish or identity recovery
   * allows special behavior.
   * However, other identity events must be published by a rotation key.
   * Setting this to true disables rotation authorization checking.
   */
  isLogin?: boolean;
}

/** Information about a published identity event. */
export interface IdentityUpdate {
  identityKey: string;
  signedEvent: Proto.SignedEvent;
}

/**
 * IdentityManager owns all identity lifecycle operations — publishing,
 * claiming, key rotation — and the authorization checks that go with them.
 */
export class IdentityManager {
  static keysEqual(a: Proto.PublicKey, b: Proto.PublicKey): boolean {
    return a.keyType === b.keyType && bytesEqual(a.key, b.key);
  }

  constructor(private readonly client: PolycentricClient) {}

  /**
   * Resolves an identity's latest known valid state from rs-core's store.
   * Defaults to the active identity, if any.
   * Returns `null` if there is no identity to check or no valid chain can
   * be found locally for the given identity.
   */
  resolveIdentity(identityKey?: string): IdentityState | null {
    const key = identityKey ?? this.client.activeIdentityKey;
    if (!key) return null;

    const identityBytes = this.client.core.resolveIdentity(key);
    if (!identityBytes) return null;

    const identity = Proto.Identity.fromBinary(new Uint8Array(identityBytes));

    return {
      identityKey: key,
      rotationKeys: identity.rotationKeys,
      signingKeys: identity.signingKeys,
      revocationBounds: identity.revocationBounds,
      servers: identity.servers ? identity.servers.urls : null,
      recoveryKey: identity.recoveryKey ?? null,
    };
  }

  /**
   * Publishes a new Identity document with the specified identity information.
   *
   * The identity key is the hex-encoded sha256 of the initial Identity content.
   * For a new identity, omit the identity key to let it be derived.
   */
  async publish(args: PublishArgs): Promise<IdentityUpdate> {
    const {
      identityKey,
      rotationKeys,
      signingKeys,
      servers = null,
      revocationBounds = [],
      recoveryKey = null,
      recoverySignature = null,
      isLogin = false,
    } = args;

    const signer = this.client.currentKeyPair?.publicKey;
    if (!signer) {
      throw new Error('No active key pair');
    }

    const identity = Proto.Identity.create({
      rotationKeys,
      signingKeys,
      revocationBounds,
      servers: servers ? { urls: servers } : undefined,
      recoveryKey: recoveryKey ?? undefined,
      recoverySignature: recoverySignature ?? undefined,
    });
    const content = Proto.Content.create({
      contentBody: { oneofKind: 'identity', identity },
    });

    const isBootstrap = !identityKey;

    if (isBootstrap) {
      if (
        rotationKeys.length !== 1 ||
        signingKeys.length !== 0 ||
        revocationBounds.length !== 0 ||
        !IdentityManager.keysEqual(rotationKeys[0], signer)
      ) {
        throw new Error(
          'Initial identity must have exactly one rotation key (the current key), no signing keys and no revocation bounds',
        );
      }
    } else if (!isLogin) {
      const oldHead = this.resolveIdentity(identityKey);
      if (!oldHead) throw new Error('No existing identity chain to extend');

      const isAuthorized = oldHead.rotationKeys.some((key) =>
        IdentityManager.keysEqual(key, signer),
      );

      if (!isAuthorized)
        throw new Error('Identity rotation is not authorized for this key');
    }

    const resolvedIdentityKey: string = isBootstrap
      ? bytesToHex(sha256(Proto.Identity.toBinary(identity)), 32)
      : identityKey;

    const digest = this.client.contentManager.buildDigest(content);
    await this.client.storage.content.save(digest, content);
    await this.client.setActiveIdentityKey(resolvedIdentityKey);

    let event: Proto.Event;
    if (isBootstrap) {
      // The bootstrap identity event
      // sequence = 1, identitySequence = 1, vectorClock = [1] for the sole signer.
      event = Proto.Event.create({
        key: Proto.EventKey.create({
          collection: COLLECTION.IDENTITY,
          identity: resolvedIdentityKey,
          signedBy: signer,
          sequence: 1n,
        }),
        identitySequence: 1n,
        vectorClock: Proto.VectorClock.create({ sequence: [1n] }),
        previousSignature: new Uint8Array(0),
        contentDigest: digest,
        createdAt: BigInt(Date.now()),
        application: this.client.application,
      });
    } else {
      event = await this.client.buildEvent(content, COLLECTION.IDENTITY);
    }

    const signedEvent = await this.client.signEvent(event);
    await this.client.commitEvent(signedEvent, content);

    // The identity document is the source of truth for the server list, so
    // adopt it before syncing — a newly added server receives the push.
    if (identity.servers) {
      this.client.servers = [...identity.servers.urls];
      this.client.core.setServers(this.client.servers);
    }

    await this.client.sync(SyncStrategy.PARTIAL_PUSH);

    return { identityKey: resolvedIdentityKey, signedEvent };
  }

  /**
   * Attempt to claim an identity:
   * - Fetch the identity's chain
   * - Check that we are authorized
   * - Adopt the identity and pull its events
   * - Re-publish the identity event under our signing key
   *
   * Returns the adopted identity state. Throws on any failure.
   */
  async claim(identityKey: string, servers?: string[]): Promise<IdentityState> {
    if (!this.client.currentKeyPair) throw new Error('No active key pair');
    const publicKey = this.client.currentKeyPair.publicKey;

    // Store these in case we need to roll back
    const previousIdentityKey = this.client.activeIdentityKey;
    const previousServers = [...this.client.servers];

    try {
      if (servers) {
        this.client.servers = [...servers];
        this.client.core.setServers(this.client.servers);
      }

      // Hydrate all known identity events for `identityKey` to rs-core
      await this.client.listEvents({
        identity: identityKey,
        collection: COLLECTION.IDENTITY,
      });

      // Check that we are authorized
      let state = this.resolveIdentity(identityKey);
      if (!state || !this.checkAuthorized(state, publicKey)) {
        throw new Error('Unable to verify authorization');
      }

      // Adopt the identity and pull in its events
      await this.client.setActiveIdentityKey(identityKey);
      await this.client.sync(SyncStrategy.PARTIAL_PULL);

      // Ensure we are still authorized after pulling
      state = this.resolveIdentity(identityKey);
      if (!state || !this.checkAuthorized(state, publicKey)) {
        throw new Error('Lost authorization');
      }

      // Re-publish the same identity document signed by our own key,
      // proving this key acknowledged its membership.
      await this.publish({ ...state, isLogin: true });

      return state;
    } catch (err: unknown) {
      // Roll back changes as best we can
      if (this.client.activeIdentityKey !== previousIdentityKey) {
        await this.client.setActiveIdentityKey(previousIdentityKey);
      }

      this.client.servers = previousServers;
      this.client.core.setServers(this.client.servers);

      throw err;
    }
  }

  /**
   * Copy a backup's identity chain into rs-core, so that resolving the identity
   * accounts for what the backup knows.
   * The identity chain is not persisted to local storage but will remain cached
   * by rs-core.
   */
  copyBackupEvents(backup: Proto.IdentityBackup): void {
    const events: ArrayBuffer[] = [];
    const contents: { digestBytes: ArrayBuffer; contentBytes: ArrayBuffer }[] =
      [];

    for (const bundle of backup.identityChain) {
      const { signedEvent, serializedContent } = bundle;
      if (!signedEvent) continue;

      events.push(
        Proto.SignedEvent.toBinary(signedEvent).buffer as ArrayBuffer,
      );

      if (!serializedContent) continue;

      let digest: Proto.ContentDigest;
      try {
        const event = Proto.Event.fromBinary(signedEvent.eventBytes);
        if (!event.contentDigest) continue;
        digest = event.contentDigest;
      } catch {
        continue;
      }

      const digestBytes = Proto.ContentDigest.toBinary(digest)
        .buffer as ArrayBuffer;
      const contentBytes = serializedContent.contentBytes.slice()
        .buffer as ArrayBuffer;
      contents.push({ digestBytes, contentBytes });
    }

    try {
      this.client.core.copyContents(contents);
      this.client.core.copyEvents(events);
    } catch (e) {
      console.warn(`Backup data failed to copy: ${e}`);
    }
  }

  /**
   * Use the backup to authorize the current key pair and log in.
   *
   * TODO: make identity handling less stateful so that we don't
   * have to rollback changes on failure. Also make this more robust
   * against obscure cases like all servers dropping our events.
   */
  async recoverIdentity(backup: Proto.IdentityBackup): Promise<void> {
    if (!this.client.currentKeyPair) throw new Error('No active key pair');
    const publicKey = this.client.currentKeyPair.publicKey;

    const identityKey = backup.identityKey;
    const recoveryKey = backup.recoveryKey;
    if (!recoveryKey) throw new Error('Backup has no recovery key');

    // Store these in case we need to roll back
    const previousIdentityKey = this.client.activeIdentityKey;
    const previousServers = [...this.client.servers];

    try {
      // Copy backup events to rs-core so we can easily read off the identity head
      this.copyBackupEvents(backup);

      const backupState = this.resolveIdentity(identityKey);
      if (!backupState) throw new Error('Backup has no valid identity chain');

      if (backupState.servers?.length) {
        this.client.servers = [...backupState.servers];
        this.client.core.setServers(this.client.servers);
      }

      // Include server knowledge of the identity chain
      await this.client.listEvents({
        identity: identityKey,
        collection: COLLECTION.IDENTITY,
      });

      // This is the identity head that we will work from
      const state = this.resolveIdentity(identityKey);
      if (!state) throw new Error('No valid identity chain to recover');

      if (state.servers?.length) {
        this.client.servers = [...state.servers];
        this.client.core.setServers(this.client.servers);
      }

      // Confirm that our recovery will be accepted
      if (!this.checkRecoveryKey(recoveryKey, identityKey)) {
        throw new Error('Unable to recover this identity with this backup');
      }

      const payload = new Uint8Array(
        this.client.core.assembleRecoveryPayload(
          identityKey,
          Proto.PublicKey.toBinary(publicKey).buffer as ArrayBuffer,
        ),
      );

      const recoverySignature = await this.client.crypto.sign(
        recoveryKey.key,
        payload,
        recoveryKey.keyType,
      );

      // Only add our key if it's not there already
      const alreadyListed = state.rotationKeys.some((key) =>
        IdentityManager.keysEqual(key, publicKey),
      );

      const rotationKeys = alreadyListed
        ? state.rotationKeys
        : [...state.rotationKeys, publicKey];

      await this.publish({
        ...state,
        isLogin: true,
        rotationKeys,
        recoverySignature,
      });
    } catch (err: unknown) {
      // Roll back changes as best we can
      if (this.client.activeIdentityKey !== previousIdentityKey) {
        await this.client.setActiveIdentityKey(previousIdentityKey);
      }

      this.client.servers = previousServers;
      this.client.core.setServers(this.client.servers);

      throw err;
    }

    // Best effort sync.
    // We have already published the new identity event, so we won't bail out
    // on failure.
    try {
      await this.client.sync(SyncStrategy.PARTIAL_PULL);
    } catch (err: unknown) {
      console.warn('Pull failed after identity recovery:', err);
    }
  }

  /**
   * Helper method for `claim()`.
   * Returns whether `state` contains `myKey` as either a rotation or signing key.
   */
  private checkAuthorized(
    state: IdentityState,
    myKey: Proto.PublicKey,
  ): boolean {
    return (
      state.rotationKeys.some((k) => IdentityManager.keysEqual(k, myKey)) ||
      state.signingKeys.some((k) => IdentityManager.keysEqual(k, myKey))
    );
  }

  isRotationKeyForIdentity(
    identityKey: string,
    publicKey: Proto.PublicKey,
  ): boolean {
    const state = this.resolveIdentity(identityKey);
    if (!state) return false;
    return state.rotationKeys.some((k) =>
      IdentityManager.keysEqual(k, publicKey),
    );
  }

  /**
   * Adds a signing key to the current identity and publishes the updated document.
   */
  async addSigningKey(publicKey: Proto.PublicKey): Promise<Proto.SignedEvent> {
    const state = this.resolveIdentity();
    if (!state) throw new Error('No active identity');

    const signingKeys = [...state.signingKeys, publicKey];
    const { signedEvent } = await this.publish({ ...state, signingKeys });
    return signedEvent;
  }

  /**
   * Removes a signing key from the current identity and publishes the updated document.
   */
  async removeSigningKey(
    publicKey: Proto.PublicKey,
  ): Promise<Proto.SignedEvent> {
    const state = this.resolveIdentity();
    if (!state) throw new Error('No active identity');

    const signingKeys = state.signingKeys.filter(
      (k) => !bytesEqual(k.key, publicKey.key),
    );
    const { signedEvent } = await this.publish({ ...state, signingKeys });
    return signedEvent;
  }

  /**
   * Adds a rotation key to the current identity and publishes the updated document.
   */
  async addRotationKey(publicKey: Proto.PublicKey): Promise<Proto.SignedEvent> {
    const state = this.resolveIdentity();
    if (!state) throw new Error('No active identity');

    const keyExists = state.rotationKeys.some((k) =>
      IdentityManager.keysEqual(k, publicKey),
    );
    if (keyExists) {
      throw new Error('Rotation key already exists');
    }

    const rotationKeys = [...state.rotationKeys, publicKey];
    const { signedEvent } = await this.publish({ ...state, rotationKeys });
    return signedEvent;
  }

  /**
   * Removes a rotation key from the current identity and publishes the updated document.
   */
  async removeRotationKey(
    publicKey: Proto.PublicKey,
  ): Promise<Proto.SignedEvent> {
    const state = this.resolveIdentity();
    if (!state) throw new Error('No active identity');

    const rotationKeys = state.rotationKeys.filter(
      (k) => !IdentityManager.keysEqual(k, publicKey),
    );
    const { signedEvent } = await this.publish({ ...state, rotationKeys });
    return signedEvent;
  }

  /**
   * Adds a server to the current identity document and publishes the update.
   * Calls the server's `GetInfo` first — an unreachable server is not added.
   */
  async addServer(url: string): Promise<Proto.SignedEvent> {
    const state = this.resolveIdentity();
    if (!state) throw new Error('No active identity');

    // An identity that has never configured its list starts from the
    // client's effective (default) servers.
    const servers = state.servers ?? this.client.servers;
    if (servers.includes(url)) {
      throw new ServerAlreadyAddedError();
    }

    await this.client.core.getServerInfo(url);

    const { signedEvent } = await this.publish({
      ...state,
      servers: [...servers, url],
    });
    return signedEvent;
  }

  /**
   * Removes a server from the current identity document and publishes the
   * update.
   */
  async removeServer(url: string): Promise<Proto.SignedEvent> {
    const state = this.resolveIdentity();
    if (!state) throw new Error('No active identity');

    const current = state.servers ?? this.client.servers;
    const servers = current.filter((s) => s !== url);
    if (servers.length === current.length) {
      throw new Error('Server not found');
    }

    const { signedEvent } = await this.publish({ ...state, servers });
    return signedEvent;
  }

  /**
   * Generate a new recovery keypair for the active identity and publish
   * a new identity event with it.
   * Returns the private key so it can be saved.
   */
  async rotateRecoveryKey(): Promise<PrivateKey> {
    const state = this.resolveIdentity();
    if (!state) throw new Error('No active identity');

    const keyType = KEY_TYPE.ED25519;

    // Generate new key pair for recovery
    const { privateKey, publicKey } =
      await this.client.crypto.generateKeyPair(keyType);

    // Try persisting a identity new event locally and publishing it to servers
    await this.publish({
      ...state,
      recoveryKey: { keyType, key: publicKey },
    });

    return { keyType, key: privateKey };
  }

  /**
   * Returns whether `privateKey` is the corresponding private key to the
   * recovery public key stored on `identityKey`, defaulting to the active
   * identity.
   */
  checkRecoveryKey(privateKey: PrivateKey, identityKey?: string): boolean {
    if (privateKey.keyType !== KEY_TYPE.ED25519) return false;

    const recoveryKey = this.resolveIdentity(identityKey)?.recoveryKey;
    if (!recoveryKey || recoveryKey.keyType !== KEY_TYPE.ED25519) return false;

    let derived: Uint8Array;
    try {
      derived = ed25519.getPublicKey(privateKey.key);
    } catch {
      return false;
    }

    return bytesEqual(derived, recoveryKey.key);
  }
}
