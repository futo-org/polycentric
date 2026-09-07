// Platform health checks. Each verifier's `healthCheck` fetches a known
// profile (text) or confirms its credentials (OAuth); the results feed the
// per-platform gauges on the dashboard. The loop runs the checks one after
// another so the headless-browser verifiers never overlap.
import {
  healthCheckDuration,
  healthCheckLastSuccess,
  healthCheckUp,
  healthChecks,
} from './metrics.js';
import { Result } from './result.js';
import { slug } from './utility.js';
import type { Verifier } from './verifier.js';

export const DEFAULT_HEALTH_CHECK_INTERVAL_SECONDS = 900;

/** Run one verifier's health check and record it. Never throws. */
export async function runHealthCheck(
  verifier: Verifier,
): Promise<Result<void>> {
  const labels = {
    platform: slug(verifier.platform),
    verifier: verifier.verifierType,
  };
  const end = healthCheckDuration.startTimer(labels);
  let result: Result<void>;
  let outcome: 'ok' | 'failed' | 'error';
  try {
    result = await verifier.healthCheck();
    outcome = result.success ? 'ok' : 'failed';
  } catch (e) {
    result = Result.errMsg(
      `Health check threw: ${e instanceof Error ? e.message : String(e)}`,
    );
    outcome = 'error';
  }
  end();
  healthChecks.inc({ ...labels, outcome });
  healthCheckUp.set(labels, result.success ? 1 : 0);
  if (result.success) {
    healthCheckLastSuccess.set(labels, Date.now() / 1000);
  }
  return result;
}

/**
 * Health check every verifier now and then every `intervalMs`. Returns a
 * function that stops the loop.
 */
export function startHealthCheckLoop(
  verifiers: Verifier[],
  intervalMs: number,
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    for (const verifier of verifiers) {
      if (stopped) return;
      const result = await runHealthCheck(verifier);
      console.log(
        `Health check ${slug(verifier.platform)}/${verifier.verifierType}: ${
          result.success ? 'ok' : result.error.message
        }`,
      );
    }
    if (!stopped) {
      timer = setTimeout(tick, intervalMs);
    }
  };

  timer = setTimeout(tick, 0);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

/** Interval from the environment; 0 disables the loop. */
export function healthCheckIntervalMs(): number {
  const raw =
    process.env.POLYCENTRIC_VERIFIER_BOT_HEALTH_CHECK_INTERVAL_SECONDS;
  const seconds = raw === undefined || raw === '' ? NaN : Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return DEFAULT_HEALTH_CHECK_INTERVAL_SECONDS * 1000;
  }
  return seconds * 1000;
}
