// Lets a flow act as a seeded user. Maestro's runScript sandbox has no SDK,
// only an http client, so run.mjs serves this in its own process (and it dies
// with it): POST /verify-newest-claim {"name"} does what it says for that user.
import { createServer } from 'node:http';
import { COLLECTION, SyncStrategy, v2 } from '@polycentric/js-core';
import { Query, QueryStatus } from '@polycentric/rs-core-wasm/generated';
import { SEEDED_USERS, keysFor } from './seed.mjs';

// identityManager.claim without its identity republish, which would add an
// identity event every run.
async function actAs(client, name) {
  const { keyType, privateKey, publicKey, identityKey } = await keysFor(
    client,
    name,
  );
  await client.storage.keys.storeKeys({ privateKey, publicKey });
  await client.setCurrentKeyPair({ keyType, privateKey, publicKey });
  // Hydrates the identity's events into rs-core, which buildEvent needs.
  await client.listEvents({
    identity: identityKey,
    collection: COLLECTION.IDENTITY,
  });
  await client.setActiveIdentityKey(identityKey);
  await client.sync(SyncStrategy.PARTIAL_PULL);
  return identityKey;
}

// The same observable dance as client.listEvents, for any query.
function fetchQuery(client, query) {
  return new Promise((resolve, reject) => {
    let data;
    // A unique key so rs-core asks the server instead of its cache.
    const observable = client.core.fetchQuery(
      ['e2e', String(Date.now())],
      query,
      undefined,
    );
    const subscription = observable.subscribe({
      next: (result) => {
        if (result.data) data = result.data;
        if (result.status === QueryStatus.Success) {
          subscription.unsubscribe();
          resolve(data);
        }
      },
      error: reject,
    });
  });
}

const eventOf = (bundle) =>
  bundle.signedEvent && v2.Event.fromBinary(bundle.signedEvent.eventBytes);

async function verifyNewestClaim(client, name) {
  const identity = await actAs(client, name);
  const bytes = await fetchQuery(
    client,
    new Query.ListTargetedVerificationClaims({ targetIdentity: identity }),
  );
  const { claimBundles } = v2.ListTargetedVerificationClaimsResponse.fromBinary(
    new Uint8Array(bytes ?? []),
  );
  // newest pending claim
  const claim = claimBundles
    .filter(
      (bundle) =>
        !bundle.verifies.some((v) => eventOf(v)?.key?.identity === identity),
    )
    .map((bundle) => bundle.claim && eventOf(bundle.claim))
    .filter((event) => event?.key)
    .sort((a, b) => Number(b.createdAt - a.createdAt))[0];
  if (!claim) throw new Error(`No pending claim targets ${name}`);

  // What the app's useVerifyClaim publishes.
  const content = v2.Content.create({
    contentBody: {
      oneofKind: 'verificationVerify',
      verificationVerify: { claimEventKey: claim.key },
    },
  });
  await client.contentManager.save(content);
  const event = await client.buildEvent(content, COLLECTION.VERIFICATIONS);
  await client.commitEvent(await client.signEvent(event), content);
  await client.sync(SyncStrategy.PARTIAL_PUSH);
  return claim.key;
}

async function handle(client, req) {
  if (req.method !== 'POST' || req.url !== '/verify-newest-claim') {
    return [404, 'Only POST /verify-newest-claim'];
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  const { name } = JSON.parse(body);
  if (!Object.values(SEEDED_USERS).includes(name)) {
    return [400, `Not a seeded user: ${name}`];
  }
  const key = await verifyNewestClaim(client, name);
  return [200, `${name} verified ${key.identity}/${key.sequence}`];
}

// Resolves to the base URL, passed to the flows as MAESTRO_VERIFY_URL.
export function startVerifyServer(client) {
  const server = createServer(async (req, res) => {
    const [status, message] = await handle(client, req).catch((error) => [
      500,
      String(error?.stack ?? error),
    ]);
    console.log(`verify-newest-claim: ${status} ${message}`);
    res.writeHead(status).end(message);
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${server.address().port}`),
    ),
  );
}
