import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import type { KeyPair, PolycentricClient } from '../polycentric-client';
import * as Proto from '../proto/v2';
import { IdentityManager } from './identity-manager';

/**
 * Default expiration time for a pairing session.
 */
export const PAIRING_SESSION_TTL_MILLIS = 5 * 60 * 1000;

/** Nonce length, in bytes, for a new session digest. */
const NONCE_BYTES = 32;

/**
 * Relevant state regarding an active pairing session.
 */
export interface PairingSession {
  /** The canonical serialized `PairingSessionDigest` for this session. */
  digestBytes: Uint8Array;

  /** The decoded digest. */
  digest: Required<Proto.PairingSessionDigest>;

  /** Pairing session state verified to be from the issuer. */
  issuerState: Proto.IssuerPairingState;

  /** Public keys to that are requesting to be paired. */
  claimers: Proto.PublicKey[];

  /** The expiration time of the pairing session. */
  expiresAt: Date;

  /** The minimal information needed to access this pairing session. */
  pairingInfo: Proto.PairingInfo;
}

/**
 * Wrappers over the rs-core's pairing API.
 */
export class PairingSessionManager {
  constructor(private readonly client: PolycentricClient) {}

  /** Sign a serialized `IssuerPairingState`. */
  private async signIssuerState(
    issuerState: Proto.IssuerPairingState,
  ): Promise<Proto.SignedIssuerState> {
    const keyPair = this.requireKeyPair();

    const stateBytes = Proto.IssuerPairingState.toBinary(issuerState);
    const signature = await this.client.crypto.sign(
      keyPair.privateKey.key,
      stateBytes,
      keyPair.keyType,
    );

    return Proto.SignedIssuerState.create({ stateBytes, signature });
  }

  /**
   * Sign and publish a new pairing session state derived from local stores.
   * Returns the server's reported pairing session state or errors if the
   * response doesn't reflect the state we pushed.
   */
  private async putState(
    server: string,
    digestBytes: Uint8Array,
    sequence: bigint,
  ): Promise<PairingSession> {
    const { issuerIdentity } = this.digestFrom(digestBytes, true);

    // Get latest identity state to push
    const chain = this.client.resolveIdentityChain(issuerIdentity);
    const identityState = chain[chain.length - 1];
    if (!identityState) {
      throw new Error(`No local identity chain for ${issuerIdentity}`);
    }

    // Assemble new state
    const issuerState = Proto.IssuerPairingState.create({
      sessionDigest: digestBytes,
      identityState,
      sequence,
    });

    const signedState = await this.signIssuerState(issuerState);

    // Push the new state and handle response
    const responseBytes = await this.client.core.putPairingSession(
      server,
      Proto.SignedIssuerState.toBinary(signedState).buffer as ArrayBuffer,
    );

    return this.decodeSession(server, responseBytes);
  }

  /**
   * Start a new pairing session and register it on `server`.
   */
  async createPairingSession(server: string): Promise<PairingSession> {
    const digestBytes = Proto.PairingSessionDigest.toBinary(
      Proto.PairingSessionDigest.create({
        issuerIdentity: this.requireIdentityKey(),
        issuerSigner: this.requireKeyPair().publicKey,
        nonce: randomBytes(NONCE_BYTES),
        initialTimestamp: BigInt(Date.now()),
        ttlMillis: BigInt(PAIRING_SESSION_TTL_MILLIS),
      }),
    );

    return await this.putState(server, digestBytes, 1n);
  }

  /**
   * Publish a new state for an existing session.
   */
  async updatePairingSession(
    server: string,
    digestBytes: Uint8Array,
    sequence: bigint,
  ): Promise<PairingSession> {
    return await this.putState(server, digestBytes, sequence);
  }

  /** Fetch a pairing session using `info`. */
  async getPairingSession(info: Proto.PairingInfo): Promise<PairingSession> {
    const stateBytes = await this.client.core.getPairingSession(
      info.server,
      toCoreBytes(info.digestSha256),
    );
    return this.decodeSession(info.server, stateBytes);
  }

  /** Register our key as a claimer on a session. */
  async joinPairingSession(info: Proto.PairingInfo): Promise<void> {
    await this.client.core.joinPairingSession(
      info.server,
      toCoreBytes(info.digestSha256),
      toCoreKey(this.requireKeyPair().publicKey),
    );
  }

  /**
   * Issuer-side poll: retrieve the server's list of claimer public keys.
   */
  async pollForClaimers(info: Proto.PairingInfo): Promise<Proto.PublicKey[]> {
    const claimers = await this.client.core.pollForClaimers(
      info.server,
      toCoreBytes(info.digestSha256),
    );
    return claimers.map(fromCoreKey);
  }

  /**
   * Claimer-side poll: check if the issuer has included our key in its latest
   * identity state.
   * We should still verify the full identity chain before fully committing.
   */
  async pollForAuthorization(info: Proto.PairingInfo): Promise<boolean> {
    return await this.client.core.pollForAuthorization(
      info.server,
      toCoreBytes(info.digestSha256),
      toCoreKey(this.requireKeyPair().publicKey),
    );
  }

  /** Get the current key pair or throw. */
  private requireKeyPair(): KeyPair {
    if (!this.client.currentKeyPair) throw new Error('No active key pair');
    return this.client.currentKeyPair;
  }

  /** Get the active identity key or throw. */
  private requireIdentityKey(): string {
    if (!this.client.activeIdentityKey) throw new Error('No active identity');
    return this.client.activeIdentityKey;
  }

  /**
   * Decode a `PairingSessionState` message received from a server.
   * Use `assertIssuer === true` when updating a state to ensure that the
   * polycentric client's identity and keypair match the pairing session's.
   */
  private digestFrom(
    digestBytes: Uint8Array,
    assertIssuer = false,
  ): Required<Proto.PairingSessionDigest> {
    const decoded = Proto.PairingSessionDigest.fromBinary(digestBytes);

    const { issuerSigner } = decoded;
    if (!issuerSigner) {
      throw new Error('Pairing session digest has no issuer signer');
    }

    // All fields are known to be present in this copy.
    const digest = { ...decoded, issuerSigner };

    if (assertIssuer) {
      if (digest.issuerIdentity !== this.requireIdentityKey()) {
        throw new Error(
          `Pairing session specifies a different identity than the active identity key`,
        );
      }

      const signerMatches = IdentityManager.keysEqual(
        issuerSigner,
        this.requireKeyPair().publicKey,
      );

      if (!signerMatches) {
        throw new Error(
          'Pairing session pins a different signer than the active key pair',
        );
      }
    }

    return digest;
  }

  /**
   * Decode a `PairingSessionState` message received from a server.
   */
  private decodeSession(
    server: string,
    stateBytes: ArrayBuffer,
  ): PairingSession {
    const state = Proto.PairingSessionState.fromBinary(
      new Uint8Array(stateBytes),
    );

    const issuerState = state.issuerState;
    if (!issuerState) {
      throw new Error('Pairing session state has no signed issuer state');
    }

    const decoded = Proto.IssuerPairingState.fromBinary(issuerState.stateBytes);
    const digestBytes = decoded.sessionDigest.slice();
    const digest = this.digestFrom(digestBytes);

    return {
      digestBytes,
      digest,
      issuerState: decoded,
      claimers: state.claimers,
      expiresAt: expiresAt(digest),
      pairingInfo: Proto.PairingInfo.create({
        server,
        digestSha256: sha256(digestBytes),
      }),
    };
  }
}

/**
 * Derive the expiration time for a pairing session.
 */
function expiresAt(digest: Proto.PairingSessionDigest): Date {
  const millis = digest.initialTimestamp + digest.ttlMillis;
  const expiration = new Date(Number(millis));

  if (Number.isNaN(expiration.getTime())) {
    throw new Error(`Pairing session expiration out of range: ${millis}`);
  }

  return expiration;
}

/** Copy bytes for the FFI. */
function toCoreBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

/** Convert to the FFI key type. */
function toCoreKey(key: Proto.PublicKey): {
  keyType: number;
  key: ArrayBuffer;
} {
  return {
    keyType: key.keyType,
    key: toCoreBytes(key.key),
  };
}

/** Convert back from the FFI key type. */
function fromCoreKey(key: {
  keyType: number;
  key: ArrayBuffer;
}): Proto.PublicKey {
  return Proto.PublicKey.create({
    keyType: key.keyType,
    key: new Uint8Array(key.key),
  });
}
