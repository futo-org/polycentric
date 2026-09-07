export * as v1 from './proto/polycentric';
export type * as v1Types from './proto/polycentric';

export * as v2 from './proto/v2';
export type * as v2Types from './proto/v2';

// Re-export commonly used v1 types (namespaced v2 types don't conflict)
export {
  Process,
  Event,
  Events,
  SignedEvent,
  RangesForSystem,
  ContentType,
  Opinion,
  Pointer,
  Post,
  Delete,
  Claim,
  ClaimFieldEntry,
  ImageManifest,
} from './proto/polycentric';
export { PublicKey, KeyType } from './proto/polycentric/v2/keypair';

export type * from './platform-interfaces';
export { bytesToHex, hexToBytes, toDigestKey } from './utils/hex';

export { StorageHandle } from './datastore';
export type { Repositories } from './datastore';

export { PolycentricClient } from './polycentric-client';
export { MemoryStorageDriver, MemoryFileStoreDriver } from './memory-storage';
export { IdentityManager } from './client-internal/identity-manager';
export { PairingSessionManager } from './client-internal/pairing-session-manager';
export type { PairingSession } from './client-internal/pairing-session-manager';
export type {
  PolycentricClientConfig,
  KeyPair,
  PrivateKey,
  IdentityState,
  PublishArgs,
  IdentityUpdate,
} from './polycentric-client';

export * from './errors';
export * as Errors from './errors';
export * from './utils';

export {
  KEY_TYPE,
  COLLECTION,
  HydrationStrategy,
  SyncStrategy,
} from './constants';

export {
  ClientState,
  InitializationStep,
  HydrationStatus,
} from './client-internal/event-service';

export {
  resolveAlias,
  normalizeAlias,
  isIdentityKey,
} from './http/alias-resolver';
export { CryptoManager } from './crypto/crypto-manager';
export { createServerJwt, type ServerJwtClaims } from './crypto/server-jwt';
