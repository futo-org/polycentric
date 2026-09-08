#!/usr/bin/env node
// Seeds the named identities the e2e flows search for ("Request verification"
// finds users by profile name on the server). Idempotent: each private key is
// derived from a fixed string, and the identity key is a hash of the identity
// document, so every machine and CI job lands on the same two identities;
// nothing is written when the server already has them.
// These are throwaway test users, so the keys being public is fine.
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { COLLECTION, KEY_TYPE, bytesToHex, v2 } from '@polycentric/js-core';
import { createPolycentricNodeClient } from '@polycentric/js-node';

// Passed to the flows as -e variables. Avoid English stop words in names: the
// server's full-text search would drop "A" and match both users.
export const VERIFIERS = {
  MAESTRO_VERIFIER_A: 'Maestro Verifier Alpha',
  MAESTRO_VERIFIER_B: 'Maestro Verifier Bravo',
};

// The app's server list; the identities live on its first server.
const SERVER = (
  process.env.EXPO_PUBLIC_POLYCENTRIC_SEED_SERVERS ?? 'http://localhost:3000'
).split(',')[0];
const STATE = new URL('.seed/', import.meta.url).pathname;

const sha256 = (data) =>
  new Uint8Array(createHash('sha256').update(data).digest());

async function seedIdentity(client, name) {
  const keyType = KEY_TYPE.ED25519;
  const privateKey = { keyType, key: sha256(`harbor-e2e:${name}`) };
  const publicKey = v2.PublicKey.create({
    keyType,
    key: await client.crypto.derivePublicKey(privateKey.key, keyType),
  });
  // The same document identityManager.publish bootstraps from, so its hash
  // is the identity key whether or not the identity exists yet.
  const identity = v2.Identity.create({
    rotationKeys: [publicKey],
    servers: { urls: [SERVER] },
  });
  const identityKey = bytesToHex(sha256(v2.Identity.toBinary(identity)));

  // Ask the server rather than local state: a fresh checkout has none, and
  // adopting the identity via identityManager.claim would publish a login
  // event on every run.
  const profiles = await client.listEvents({
    identity: identityKey,
    collection: COLLECTION.PROFILE,
  });
  if (profiles.length > 0) {
    console.log(`${name}: ${identityKey} (exists)`);
    return;
  }

  await client.storage.keys.storeKeys({ privateKey, publicKey });
  await client.setCurrentKeyPair({ keyType, privateKey, publicKey });
  await client.identityManager.publish({
    rotationKeys: [publicKey],
    signingKeys: [],
    servers: [SERVER],
  });
  const content = client.contentManager.build({
    oneofKind: 'profileUpdate',
    profileUpdate: { name, description: 'Seeded for e2e tests' },
  });
  await client.contentManager.save(content);
  const event = await client.buildEvent(content, COLLECTION.PROFILE);
  await client.commitEvent(await client.signEvent(event), content);
  await client.sync();
  console.log(`${name}: ${client.activeIdentityKey}`);
}

export async function seed() {
  mkdirSync(`${STATE}blobs`, { recursive: true });
  const client = await createPolycentricNodeClient({
    databasePath: `${STATE}seed.db`,
    blobDirectory: `${STATE}blobs`,
    seedServers: [SERVER],
  });
  for (const name of Object.values(VERIFIERS)) await seedIdentity(client, name);
}

if (import.meta.main) {
  await seed();
  process.exit(0);
}
