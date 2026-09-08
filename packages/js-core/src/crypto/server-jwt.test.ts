import { ed25519 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';
import { KEY_TYPE } from '../constants';
import type { KeyPair } from '../polycentric-client';
import { base64Decode, base64DecodeString } from '../utils/base64';
import { bytesToHex } from '../utils/hex';
import { createServerJwt } from './server-jwt';

const PRIVATE_KEY = new Uint8Array(32).fill(7);
const PUBLIC_KEY = ed25519.getPublicKey(PRIVATE_KEY);

const KEY_PAIR: KeyPair = {
  keyType: KEY_TYPE.ED25519,
  privateKey: { keyType: KEY_TYPE.ED25519, key: PRIVATE_KEY },
  publicKey: { keyType: KEY_TYPE.ED25519, key: PUBLIC_KEY },
};

const IDENTITY = 'identity-key-hex';
const SERVER = 'https://server.example.com';

function decodeSegment(segment: string): Record<string, unknown> {
  const json = base64DecodeString(segment);
  if (json === undefined) throw new Error(`not base64: ${segment}`);
  return JSON.parse(json);
}

async function createParts() {
  const jwt = await createServerJwt({
    keyPair: KEY_PAIR,
    iss: IDENTITY,
    aud: SERVER,
  });
  const [header, claims, signature] = jwt.split('.');
  return { jwt, header, claims, signature };
}

describe('createServerJwt', () => {
  it('carries the issuer, audience, and signing key', async () => {
    const { header, claims } = await createParts();

    expect(decodeSegment(header)).toEqual({
      alg: 'EdDSA',
      typ: 'JWT',
      kid: bytesToHex(PUBLIC_KEY),
    });
    const decoded = decodeSegment(claims);
    expect(decoded.iss).toBe(IDENTITY);
    expect(decoded.aud).toBe(SERVER);
  });

  it('expires in one hour by default', async () => {
    const { claims } = await createParts();
    const { iat, exp } = decodeSegment(claims) as { iat: number; exp: number };

    expect(iat).toBeCloseTo(Date.now() / 1000, -1);
    expect(exp - iat).toBe(60 * 60);
  });

  it('honours a custom expiry', async () => {
    const jwt = await createServerJwt({
      keyPair: KEY_PAIR,
      iss: IDENTITY,
      aud: SERVER,
      expirySeconds: 30,
    });
    const { iat, exp } = decodeSegment(jwt.split('.')[1]) as {
      iat: number;
      exp: number;
    };
    expect(exp - iat).toBe(30);
  });

  it('signs header.claims with the keypair (EdDSA)', async () => {
    const { header, claims, signature } = await createParts();

    const signatureBytes = base64Decode(signature);
    if (signatureBytes === undefined) {
      throw new Error(`not base64: ${signature}`);
    }

    const verified = ed25519.verify(
      signatureBytes,
      new TextEncoder().encode(`${header}.${claims}`),
      PUBLIC_KEY,
    );
    expect(verified).toBe(true);
  });

  it('rejects a non-ed25519 keypair', async () => {
    await expect(
      createServerJwt({
        keyPair: { ...KEY_PAIR, keyType: 0 },
        iss: IDENTITY,
        aud: SERVER,
      }),
    ).rejects.toThrow('Unsupported key type');
  });
});
