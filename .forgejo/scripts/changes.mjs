#!/usr/bin/env node
// Turns the GitLab rules (changed paths + ref conditions) into the plan that
// pr.yml gates its jobs with: `flags` (one per job) and `matrix` rows (one
// per grouped job). Needs a full clone.
//
// Env: GITHUB_*, REGISTRY, EVENT_BEFORE.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const env = process.env;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

// Run context ---------------------------------------------------------------

const event = env.GITHUB_EVENT_NAME;
const pr = event === 'pull_request';
const isTag = env.GITHUB_REF.startsWith('refs/tags/');

// Changed files -------------------------------------------------------------
// null = every path matches (manual runs, GitLab web pipelines); [] = none.

const changedFiles = () => {
  if (isTag) return [];
  if (pr) {
    const base = git('merge-base', `origin/${env.GITHUB_BASE_REF}`, 'HEAD');
    return git('diff', '--name-only', base, 'HEAD').split('\n');
  }
  const before = env.EVENT_BEFORE;
  if (event === 'push' && before && !/^0+$/.test(before)) {
    try {
      return git('diff', '--name-only', before, env.GITHUB_SHA).split('\n');
    } catch {
      // `before` is not in the clone (force push): treat as all changed.
    }
  }
  return null;
};
const changed = changedFiles();
console.log(
  changed === null
    ? 'changed files: all'
    : `changed files:\n${changed.join('\n')}`,
);

// Patterns are regexes or path prefixes.
const touches = (...patterns) =>
  changed === null ||
  changed.some((file) =>
    patterns
      .flat()
      .some((p) => (typeof p === 'string' ? file.startsWith(p) : p.test(file))),
  );

// Source rules (GitLab `changes:`) ------------------------------------------

const CARGO = /^Cargo\.(toml|lock)$/;
const LOCK = /^pnpm-lock\.yaml$/;
const CHARTS = 'deploy/charts/';
const NODE_ROOT = [
  LOCK,
  /^pnpm-workspace\.yaml$/,
  /^package\.json$/,
  'tools/',
  'patches/',
];
const SERVER_STACK = [
  'services/server/',
  'services/common/',
  /^compose\.yml$/,
  '.gitlab/ci/scripts/integration-server.sh',
];

const rsCore = touches(CARGO, /^packages\/rs-[^/]+\//);
const rsCoreWasm = touches(LOCK, 'patches/', 'packages/rs-core-wasm/');
const jsSdk = touches(LOCK, /^packages\/js-[^/]+\//);
const rnSdk = touches(LOCK, 'packages/react-native/');
const ktCore = touches(
  /^Cargo\.lock$/,
  'packages/kt-core/',
  'packages/rs-core/',
  'packages/rs-common/',
  'protos/',
);
const server = touches(CARGO, SERVER_STACK, CHARTS);
const serverIntegration = touches(CARGO, SERVER_STACK);
const moderation = touches(
  CARGO,
  'services/moderation/',
  'services/common/',
  CHARTS,
);
const moderationIntegration = touches(
  'services/moderation/',
  'services/server/',
  /^compose\.yml$/,
  '.gitlab/ci/scripts/integration-moderation.sh',
);
const pushNotifications = touches(
  CARGO,
  'services/push-notifications/',
  'services/common/',
  CHARTS,
);
const scraper = touches(NODE_ROOT, 'services/scraper/', CHARTS);
const verifierBot = touches(
  NODE_ROOT,
  /^packages\/js-[^/]+\//,
  'packages/rs-core-wasm/',
  'services/verifier-bot/',
  CHARTS,
);
const app = touches(LOCK, 'apps/', CHARTS);
const docs = touches('docs/');
const charts = touches(
  CHARTS,
  NODE_ROOT,
  'packages/',
  'apps/',
  CARGO,
  'services/',
);

// CI rules ------------------------------------------------------------------
// A workflow's jobs also rerun when the workflow, or an action or script it
// uses, changes (GitLab: the job's include file), not on any .forgejo change.

const ciFiles = (workflow) => {
  const files = new Set();
  const visit = (file) => {
    if (files.has(file) || !existsSync(file)) return;
    files.add(file);
    const text = readFileSync(file, 'utf8');
    for (const [, name] of text.matchAll(/\.\/\.forgejo\/actions\/([\w-]+)/g)) {
      visit(`.forgejo/actions/${name}/action.yml`);
    }
    for (const [, name] of text.matchAll(/\.forgejo\/scripts\/([\w.-]+)/g)) {
      files.add(`.forgejo/scripts/${name}`);
    }
  };
  visit(`.forgejo/workflows/${workflow}.yml`);
  return [...files];
};
const ciChanged = (workflow) => touches(ciFiles(workflow));
// The jobs of one workflow.
const jobs = (workflow, flags) =>
  Object.fromEntries(
    Object.entries(flags).map(([name, on]) => [
      name,
      on || ciChanged(workflow),
    ]),
  );

// Jobs ----------------------------------------------------------------------

const flags = {
  ...jobs('pr', {
    workflows: touches('.forgejo/'),
    scan: pr,
    rs_core_lint: rsCore,
    rust_services_lint: server || moderation || pushNotifications,
    js_sdk_lint: jsSdk,
    js_services_lint: scraper || verifierBot,
    charts_lint: charts,
    docs_lint: docs,
    app_lint: app,
    rs_core: rsCore,
    js_sdk: jsSdk,
    push_notifications: pushNotifications,
    scraper,
    app,
    build_wasm: rsCoreWasm || rsCore,
    build_rn: rnSdk || rsCore,
    build_sdks: rsCore || jsSdk || rnSdk || app || verifierBot,
    build_rn_sdk: rnSdk || rsCore || app,
    kt_core_build: ktCore,
    image_scraper: scraper,
    image_verifier_bot: verifierBot,
    web_image: app,
    server_integration: serverIntegration,
    moderation_integration: moderationIntegration,
    scraper_integration: scraper,
    verifier_bot_tests: verifierBot,
    web_e2e: app,
    docs,
    docs_preview: docs && pr,
  }),
};

// Matrix rows ---------------------------------------------------------------
// `image` is the id (artifacts, cache keys), `label` what the UI shows.

const rustServices = [
  {
    image: 'server',
    label: 'server',
    dockerfile: 'services/server',
    changed: server,
  },
  {
    image: 'moderation-service',
    label: 'moderation',
    dockerfile: 'services/moderation',
    changed: moderation,
  },
  {
    image: 'push-notifications-service',
    label: 'push notifications',
    dockerfile: 'services/push-notifications',
    changed: pushNotifications,
  },
];

const matrix = {
  service_images: rustServices
    .filter((s) => s.changed || ciChanged('pr'))
    .map(({ image, label, dockerfile }) => ({
      image,
      label: `Build ${label} image`,
      dockerfile,
    })),
};
for (const [name, rows] of Object.entries(matrix)) {
  flags[name] = rows.length > 0;
  matrix[name] = { include: rows };
}
// Forgejo creates no job from an empty matrix and blocks whatever needs it:
// the integration tests need this one.
if (!flags.service_images) {
  matrix.service_images.include.push({ label: 'Build service images' });
}
// Jobs that download the SDK artifacts (sdk-artifacts action) need them built.
flags.build_sdks ||=
  flags.image_verifier_bot || flags.verifier_bot_tests || flags.web_image;
flags.build_rn_sdk ||= flags.web_image;

// Outputs -------------------------------------------------------------------

const out = (name, value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  appendFileSync(env.GITHUB_OUTPUT, `${name}=${text}\n`);
  console.log(`${name}=${text}`);
};
out('registry', env.REGISTRY);
// CI images are tagged by the content of .gitlab/images; unchanged inputs
// mean an existing tag and no build.
out('images_tag', git('rev-parse', 'HEAD:.gitlab/images').slice(0, 12));
out('plan', { flags, matrix });
