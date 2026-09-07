// Prometheus metrics (scraped by VictoriaMetrics via the pod annotations, see
// deploy/charts/harbor-verifier-bot). Everything is `verifier_bot_`-prefixed
// so the dashboard needs no namespace filter. `platform` is the route slug
// (bounded by the platform list; anything else is 'other').
import {
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics,
  register,
} from 'prom-client';

// Node's default metrics keep their generic names; the label picks ours out.
register.setDefaultLabels({ service: 'verifier-bot' });
collectDefaultMetrics();

export { register };

export const httpRequests = new Counter({
  name: 'verifier_bot_http_requests_total',
  help: 'Requests handled, by platform, endpoint and status.',
  labelNames: ['platform', 'endpoint', 'status'],
});

export const httpDuration = new Histogram({
  name: 'verifier_bot_http_request_duration_seconds',
  help: 'Wall time to answer a request, by platform and endpoint.',
  labelNames: ['platform', 'endpoint'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60],
});

export type VerificationOutcome =
  | 'ok'
  | 'bad_request'
  | 'claim_fetch_failed'
  | 'schema_mismatch'
  | 'platform_mismatch'
  | 'rejected'
  | 'publish_failed';

export const verifications = new Counter({
  name: 'verifier_bot_verifications_total',
  help: 'Verify requests by platform, verifier type and outcome.',
  labelNames: ['platform', 'verifier', 'outcome'],
});

export const verificationDuration = new Histogram({
  name: 'verifier_bot_verification_duration_seconds',
  help: 'End-to-end verify time including the upstream profile fetch and publish.',
  labelNames: ['platform', 'verifier'],
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60],
});

// outcome: ok | failed (returned an error) | error (threw)
export const healthChecks = new Counter({
  name: 'verifier_bot_health_checks_total',
  help: 'Platform health checks (scheduled and on demand) by outcome.',
  labelNames: ['platform', 'verifier', 'outcome'],
});

export const healthCheckDuration = new Histogram({
  name: 'verifier_bot_health_check_duration_seconds',
  help: 'Time a platform health check took.',
  labelNames: ['platform', 'verifier'],
  buckets: [0.25, 0.5, 1, 2.5, 5, 10, 20, 30, 60],
});

export const healthCheckUp = new Gauge({
  name: 'verifier_bot_health_check_up',
  help: '1 when the last health check for the platform passed, else 0.',
  labelNames: ['platform', 'verifier'],
});

export const healthCheckLastSuccess = new Gauge({
  name: 'verifier_bot_health_check_last_success_timestamp_seconds',
  help: 'Unix time of the last passing health check for the platform.',
  labelNames: ['platform', 'verifier'],
});

/** Gauge of OAuth sign-ins started (URL handed out) but not yet called back. */
export const oauthSessionsGauge = (pending: () => number): Gauge =>
  new Gauge({
    name: 'verifier_bot_oauth_sessions_pending',
    help: 'OAuth sign-ins started but not yet returned to the callback.',
    collect() {
      this.set(pending());
    },
  });

const VERIFIER_ENDPOINTS = new Set([
  'verify',
  'url',
  'token',
  'check',
  'get-claim-fields-by-url',
  'health-check',
]);

/**
 * Bounded labels for a request path. Platform routes collapse to their slug
 * and endpoint; anything unrecognised is 'other' so bad URLs can't grow the
 * series set.
 */
export function routeLabels(
  pathname: string,
  knownPlatforms: ReadonlySet<string>,
): { platform: string; endpoint: string } {
  const segments = pathname.split('/').filter((s) => s.length > 0);
  if (
    segments.length === 1 &&
    ['metrics', 'identity', 'platforms'].includes(segments[0])
  ) {
    return { platform: '', endpoint: segments[0] };
  }
  if (segments[0] !== 'platforms' || !knownPlatforms.has(segments[1])) {
    return { platform: '', endpoint: 'other' };
  }
  const platform = segments[1];
  if (segments.length === 2) {
    return { platform, endpoint: 'platform' };
  }
  if (
    segments.length === 4 &&
    segments[2] === 'oauth' &&
    segments[3] === 'callback'
  ) {
    return { platform, endpoint: 'oauth-callback' };
  }
  if (segments.length === 4 && VERIFIER_ENDPOINTS.has(segments[3])) {
    return { platform, endpoint: segments[3] };
  }
  return { platform, endpoint: 'other' };
}
