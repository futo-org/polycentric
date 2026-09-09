#!/usr/bin/env node
// What staging and production run: the commit each chart's environment tag
// pins (its appVersion) and whether the image tag agrees. Reads the registry
// anonymously, so it works locally: node .forgejo/scripts/deployed.mjs
//
// Built is when the chart was packaged, not when the tag moved.
// Env: REGISTRY (default registry.futo.org/harbor).

import { readdirSync, readFileSync } from 'node:fs';

const env = process.env;
const registry = env.REGISTRY || 'registry.futo.org/harbor';
const [host, ...path] = registry.split('/');
const base = `https://${host}/v2/${path.join('/')}`;
const environments = ['staging', 'production'];

const accept = [
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

const request = async (route, method = 'GET') => {
  const response = await fetch(`${base}/${route}`, {
    method,
    headers: { accept },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${method} ${route}: ${response.status}`);
  return response;
};

const digest = async (repo, tag) =>
  (await request(`${repo}/manifests/${tag}`, 'HEAD'))?.headers.get(
    'docker-content-digest',
  );

// The chart's config blob is its Chart.yaml: appVersion is the commit.
const chartAt = async (name, tag) => {
  const manifest = await (
    await request(`charts/${name}/manifests/${tag}`)
  )?.json();
  if (!manifest) return null;
  const config = await (
    await request(`charts/${name}/blobs/${manifest.config.digest}`)
  ).json();
  return {
    version: config.version,
    commit: config.appVersion,
    built: manifest.annotations?.['org.opencontainers.image.created'] ?? '',
  };
};

const charts = readdirSync('deploy/charts')
  .sort()
  .map((name) => {
    const values = readFileSync(`deploy/charts/${name}/values.yaml`, 'utf8');
    const repository = values.match(/^\s*repository:\s*(\S+)/m)?.[1] ?? '';
    const image = repository.startsWith(`${registry}/`)
      ? repository.slice(registry.length + 1)
      : null;
    return { name, image };
  });

const row = async ({ name, image }, environment) => {
  const chart = await chartAt(name, environment);
  if (!chart) return [name, '-', '-', '-', 'not deployed'];
  let state = 'ok';
  if (image) {
    const [live, pinned] = await Promise.all([
      digest(image, environment),
      digest(image, chart.commit),
    ]);
    if (!pinned) state = 'image missing';
    else if (live !== pinned) state = 'image tag differs';
  }
  return [
    name,
    chart.version,
    chart.commit.slice(0, 8),
    chart.built.replace('T', ' ').slice(0, 16),
    state,
  ];
};

const widths = [26, 30, 10, 18];
const print = (cells) =>
  console.log(
    `  ${cells.map((c, i) => (i < widths.length ? c.padEnd(widths[i]) : c)).join('')}`,
  );

for (const environment of environments) {
  const rows = await Promise.all(charts.map((c) => row(c, environment)));
  console.log(environment);
  print(['chart', 'version', 'commit', 'built', 'state']);
  for (const cells of rows) print(cells);
  console.log();
}
