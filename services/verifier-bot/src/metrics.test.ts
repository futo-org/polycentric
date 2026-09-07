import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { runHealthCheck } from './health.js';
import {
  healthCheckLastSuccess,
  healthCheckUp,
  healthChecks,
  register,
  routeLabels,
} from './metrics.js';
import { Result } from './result.js';
import { TextVerifier } from './verifier.js';

describe('routeLabels', () => {
  const known = new Set(['github', 'x']);

  test('names the fixed routes', () => {
    assert.deepEqual(routeLabels('/metrics', known), {
      platform: '',
      endpoint: 'metrics',
    });
    assert.deepEqual(routeLabels('/platforms', known), {
      platform: '',
      endpoint: 'platforms',
    });
  });

  test('splits platform routes into platform and endpoint', () => {
    assert.deepEqual(routeLabels('/platforms/github', known), {
      platform: 'github',
      endpoint: 'platform',
    });
    assert.deepEqual(routeLabels('/platforms/github/text/verify', known), {
      platform: 'github',
      endpoint: 'verify',
    });
    assert.deepEqual(routeLabels('/platforms/x/oauth/callback', known), {
      platform: 'x',
      endpoint: 'oauth-callback',
    });
  });

  test('collapses anything unknown so labels stay bounded', () => {
    assert.deepEqual(routeLabels('/platforms/nope/text/verify', known), {
      platform: '',
      endpoint: 'other',
    });
    assert.deepEqual(routeLabels('/platforms/github/text/whatever', known), {
      platform: 'github',
      endpoint: 'other',
    });
    assert.deepEqual(routeLabels('/wp-admin', known), {
      platform: '',
      endpoint: 'other',
    });
  });
});

class FakeVerifier extends TextVerifier {
  constructor(private readonly behaviour: 'ok' | 'fail' | 'throw') {
    super('Fake Platform');
  }
  public override async healthCheck(): Promise<Result<void>> {
    if (this.behaviour === 'throw') throw new Error('boom');
    return this.behaviour === 'ok' ? Result.ok() : Result.errMsg('down');
  }
  protected async getText(): Promise<Result<string>> {
    return Result.ok('');
  }
  public async getClaimFieldsByUrl(): Promise<Result<never[]>> {
    return Result.ok([]);
  }
}

const labels = { platform: 'fake-platform', verifier: 'text' };

describe('runHealthCheck', () => {
  test('records a pass', async () => {
    const before = Date.now() / 1000;
    const result = await runHealthCheck(new FakeVerifier('ok'));
    assert.ok(result.success);
    assert.equal((await healthCheckUp.get()).values.find(byLabels)?.value, 1);
    const last = (await healthCheckLastSuccess.get()).values.find(byLabels);
    assert.ok(last && last.value >= before);
  });

  test('records a failure without clearing the last success', async () => {
    const result = await runHealthCheck(new FakeVerifier('fail'));
    assert.equal(result.success, false);
    assert.equal((await healthCheckUp.get()).values.find(byLabels)?.value, 0);
    assert.ok((await healthCheckLastSuccess.get()).values.find(byLabels));
    assert.equal(await outcome('failed'), 1);
  });

  test('turns a throwing check into an error outcome', async () => {
    const result = await runHealthCheck(new FakeVerifier('throw'));
    assert.equal(result.success, false);
    assert.match(result.error.message, /boom/);
    assert.equal(await outcome('error'), 1);
  });

  test('exposes the series on the registry', async () => {
    const body = await register.metrics();
    assert.match(
      body,
      /verifier_bot_health_check_up\{[^}]*platform="fake-platform"[^}]*\} 0/,
    );
  });
});

function byLabels(v: { labels: Record<string, string | number> }): boolean {
  return (
    v.labels.platform === labels.platform &&
    v.labels.verifier === labels.verifier
  );
}

async function outcome(name: string): Promise<number | undefined> {
  const metric = await healthChecks.get();
  return metric.values.find((v) => byLabels(v) && v.labels.outcome === name)
    ?.value;
}
