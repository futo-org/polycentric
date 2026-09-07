import type { PolycentricClient, v2Types } from '@polycentric/js-core';

export interface CreatePolycentricClientConfig {
  databaseName?: string;
  /** gRPC-web URLs the client should start with. */
  seedServers?: string[];
  /** Stamped on every event the client builds. */
  application?: v2Types.Application;
}

export function normalizeDatabaseName(databaseName?: string) {
  return (databaseName ?? 'polycentric').trim() || 'polycentric';
}

/**
 * Build a non-blocking log sink for `setLogger`.
 *
 * Every rs-core log crosses the FFI boundary as a synchronous host call.
 * Calling `console.log` inline for each one stalls the JS thread under a
 * burst (RN's `console.log` is slow, worse with a debugger attached), which
 * can freeze the UI. Instead we enqueue messages and flush them in a single
 * batched `console.log` on the next tick, and drop oldest under backpressure
 * so a flood can neither block the caller nor grow unbounded.
 */
export function createBatchingLogSink(maxQueue = 1000): {
  log: (message: string) => void;
} {
  const queue: string[] = [];
  let scheduled = false;
  let dropped = 0;

  const flush = () => {
    scheduled = false;
    if (dropped > 0) {
      console.warn(
        `[polycentric] dropped ${dropped} log message(s) (backpressure)`,
      );
      dropped = 0;
    }
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length).join('\n');
    console.log(batch);
  };

  return {
    log: (message: string) => {
      if (queue.length >= maxQueue) {
        dropped++;
        return;
      }
      queue.push(message);
      if (!scheduled) {
        scheduled = true;
        // Defer off the FFI caller so the Rust->JS callback returns
        // immediately; many logs in one tick collapse into one console.log.
        setTimeout(flush, 0);
      }
    },
  };
}

/**
 * Publishes a new Identity document authorized by the client's current
 * keypair, and registers `server` so the new identity is synced there.
 *
 * The keypair itself is auto-created by `PolycentricClient.initialize()`
 * on every device — this helper is specifically the identity-creation
 * step of onboarding (the "I am starting a new identity" path).
 *
 * For the "join an existing identity" path, use
 * `client.identityManager.claim(identityKey)` instead.
 */
export async function createIdentity(
  client: PolycentricClient,
  server: string,
) {
  if (!client.currentKeyPair) {
    throw new Error(
      'createIdentity: client has no current keypair. PolycentricClient.initialize() should have created one.',
    );
  }

  const currentKey = client.currentKeyPair.publicKey;

  if (!client.servers.includes(server)) {
    client.servers.push(server);
  }
  await client.identityManager.publish({
    rotationKeys: [currentKey],
    signingKeys: [],
    servers: client.servers,
  });
}
