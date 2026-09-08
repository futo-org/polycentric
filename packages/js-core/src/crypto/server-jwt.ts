import { ed25519 } from '@noble/curves/ed25519.js';
import { KEY_TYPE } from '../constants';
import type { KeyPair } from '../polycentric-client';
import { base64Encode, base64EncodeString } from '../utils/base64';
import { bytesToHex } from '../utils/hex';

/** How long a server JWT stays valid unless overridden. */
export const DEFAULT_EXPIRY_SECONDS = 60 * 60;

/** The claims carried by a server JWT. */
export interface ServerJwtClaims {
  /** The identity authenticating (its identity key). */
  iss: string;
  /** The server the token authenticates against. */
  aud: string;
  iat: number;
  exp: number;
}

/**
 * Create a JWT authenticating `iss` (an identity key) against `aud` (a
 * server URL). EdDSA-signed with `keyPair`, signing key in the header's
 * `kid` as hex.
 */
export async function createServerJwt(options: {
  keyPair: KeyPair;
  iss: string;
  aud: string;
  /** Seconds until the token expires. Defaults to 1 hour. */
  expirySeconds?: number;
}): Promise<string> {
  const { keyPair, iss, aud, expirySeconds = DEFAULT_EXPIRY_SECONDS } = options;

  if (keyPair.keyType !== KEY_TYPE.ED25519) {
    throw new Error(`Unsupported key type: ${keyPair.keyType}`);
  }

  const header = {
    alg: 'EdDSA',
    typ: 'JWT',
    kid: bytesToHex(keyPair.publicKey.key),
  };

  const iat = Math.floor(Date.now() / 1000);
  const claims: ServerJwtClaims = {
    iss,
    aud,
    iat,
    exp: iat + expirySeconds,
  };

  const signingInput = `${encodeSegment(header)}.${encodeSegment(claims)}`;
  const signature = ed25519.sign(
    new TextEncoder().encode(signingInput),
    keyPair.privateKey.key,
  );

  return `${signingInput}.${base64Encode(signature, true)}`;
}

/** A JSON value as an unpadded base64url JWT segment. */
function encodeSegment(value: object): string {
  return base64EncodeString(JSON.stringify(value), true);
}
