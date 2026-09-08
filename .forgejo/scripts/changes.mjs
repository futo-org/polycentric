#!/usr/bin/env node
// Turns the GitLab rules (changed paths + ref conditions) into the plan that
// ci.yml hands to the component workflows: `flags` (one per job) and `matrix`
// rows (one per grouped job). Needs a full clone.
//
// Env: GITHUB_*, REGISTRY, DEFAULT_BRANCH, STAGING_BRANCHES, EVENT_BEFORE,
// PR_LABELS (JSON), INPUT_EAS_STAGING, INPUT_EAS_PRODUCTION, INPUT_IOS_E2E.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const env = process.env;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const input = (name) => env[name] === 'true';

// Run context ---------------------------------------------------------------

const event = env.GITHUB_EVENT_NAME;
const ref = env.GITHUB_REF;
const defaultBranch = env.DEFAULT_BRANCH || 'develop';
const branch = ref.startsWith('refs/heads/')
  ? ref.slice('refs/heads/'.length)
  : null;

const dispatch = event === 'workflow_dispatch';
const schedule = event === 'schedule';
const pr = event === 'pull_request';
const prLabelled = (name) =>
  pr && JSON.parse(env.PR_LABELS || '[]').some((label) => label.name === name);

const isTag = ref.startsWith('refs/tags/');
const release = /^refs\/tags\/v\d+\.\d+\.\d+/.test(ref);
const appRelease = release || ref.startsWith('refs/tags/app-');

// GitLab CI_COMMIT_BRANCH == CI_DEFAULT_BRANCH: a push or "Run pipeline".
const branchRun = branch !== null && (event === 'push' || dispatch);
const defaultRef = branchRun && branch === defaultBranch;
const stagingBranches = (env.STAGING_BRANCHES || defaultBranch).split(',');
const stagingRef =
  branchRun && stagingBranches.map((b) => b.trim()).includes(branch);

const refSlug = (env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME)
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 63);

// Changed files -------------------------------------------------------------
// null = every path matches (manual runs, GitLab web pipelines); [] = none.

const changedFiles = () => {
  if (isTag || schedule) return [];
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
const appEas = touches(LOCK, 'apps/');
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

const docsChanged = docs || ciChanged('ci-docs') || ciChanged('cd-docs');

// EAS: staging from staging branches, a manual run or the build-app PR label;
// production from app release tags or a manual run on the default branch.
const easStaging =
  (stagingRef && appEas) ||
  (dispatch && input('INPUT_EAS_STAGING')) ||
  prLabelled('build-app');
const easProduction =
  appRelease || (dispatch && defaultRef && input('INPUT_EAS_PRODUCTION'));
const iosE2e = dispatch && input('INPUT_IOS_E2E');

// Jobs ----------------------------------------------------------------------

const flags = {
  ci: touches(
    '.forgejo/workflows/',
    '.forgejo/actions/',
    '.forgejo/scripts/',
    '.forgejo/zizmor.yml',
  ),
  scan: pr || defaultRef,
  release,
  verifier_health: schedule,
  docs: docsChanged,
  docs_deploy: docsChanged && defaultRef,
  docs_preview: docsChanged && pr,
  // Staging deploys, each right after its build.
  deploy_scraper: stagingRef && scraper,
  deploy_verifier_bot: stagingRef && verifierBot,
  deploy_web: stagingRef && app,
  ...jobs('ci-checks', {
    rs_core: rsCore,
    js_sdk: jsSdk,
    server,
    moderation,
    push_notifications: pushNotifications,
    scraper,
    verifier_bot: verifierBot,
    app_checks: app || (appRelease && !release),
    charts_lint: charts,
  }),
  ...jobs('ci-packages', {
    build_wasm: rsCoreWasm || rsCore || release,
    build_rn: rnSdk || rsCore || release,
    build_sdks:
      rsCore || jsSdk || rnSdk || app || verifierBot || appRelease || schedule,
    build_rn_sdk: rnSdk || rsCore || app || appRelease,
    kt_core_build: ktCore || release,
  }),
  ...jobs('ci-rust-services', {
    server_integration: serverIntegration,
    moderation_integration: moderationIntegration,
  }),
  ...jobs('ci-js-services', {
    scraper_integration: scraper || schedule,
    verifier_bot_tests: verifierBot || schedule,
    image_scraper: scraper || release,
    image_verifier_bot: verifierBot || release,
  }),
  ...jobs('ci-app', {
    web_image: app || appRelease,
    web_e2e: app || (appRelease && !release),
  }),
  // Deploys retag the chart, so staging branches publish it every run.
  charts: stagingRef,
};

// Matrix rows ---------------------------------------------------------------
// `image`/`name` is the id (artifacts, cache keys), `label` what the UI shows.

const rustServices = [
  {
    image: 'server',
    label: 'server',
    dockerfile: 'services/server',
    chart: 'harbor-server',
    changed: server,
  },
  {
    image: 'moderation-service',
    label: 'moderation',
    dockerfile: 'services/moderation',
    chart: 'harbor-moderation',
    changed: moderation,
  },
  {
    image: 'push-notifications-service',
    label: 'push notifications',
    dockerfile: 'services/push-notifications',
    chart: 'harbor-push-notifications',
    changed: pushNotifications,
  },
];

const channels = [
  {
    channel: 'staging',
    app_id: 'org.futo.polycentric.staging',
    build: easStaging,
    publish: stagingRef && appEas,
  },
  {
    channel: 'production',
    app_id: 'org.futo.polycentric',
    build: easProduction,
    publish: easProduction,
  },
];
const easBuilds = channels.filter((c) => c.build);
const publishes = channels.filter((c) => c.publish);

const matrix = {
  service_images: rustServices
    .filter((s) => s.changed || release || ciChanged('ci-rust-services'))
    .map(({ image, label, dockerfile }) => ({
      image,
      label: `Build ${label} image`,
      dockerfile,
    })),
  // Store builds only queue on EAS; the APK build waits for its archive.
  eas_store: easBuilds.flatMap(({ channel }) => [
    {
      name: `app-android-aab-${channel}`,
      label: `Build Android AAB (${channel})`,
      platform: 'android',
      profile: channel,
    },
    {
      name: `app-ios-${channel}`,
      label: `Build iOS app (${channel})`,
      platform: 'ios',
      profile: channel,
    },
  ]),
  eas_apk: easBuilds.map(({ channel }) => ({
    name: `app-android-apk-${channel}`,
    label: `Build Android APK (${channel})`,
    platform: 'android',
    profile: `${channel}-apk`,
  })),
  deploy_store: publishes.flatMap(({ channel }) => [
    {
      channel,
      platform: 'android',
      label: `Deploy Android app to ${channel}`,
      build: `app-android-aab-${channel}`,
    },
    {
      channel,
      platform: 'ios',
      label: `Deploy iOS app to ${channel}`,
      build: `app-ios-${channel}`,
    },
  ]),
  deploy_apk: publishes.map(({ channel }) => ({
    channel,
    label: `Deploy APK to ${channel}`,
  })),
  ios_e2e: easBuilds
    .filter(() => iosE2e)
    .map(({ channel, app_id }) => ({
      channel,
      label: `Test iOS e2e (${channel})`,
      app_id,
    })),
  deploy_rust_services: rustServices
    .filter((s) => stagingRef && s.changed)
    .map(({ image, label, chart }) => ({
      image,
      label: `Deploy ${label} to staging`,
      chart,
    })),
};
for (const [name, rows] of Object.entries(matrix)) {
  flags[name] = rows.length > 0;
  matrix[name] = { include: rows };
}
// Forgejo creates no job from an empty matrix and blocks whatever needs it:
// services-integration needs this one.
if (!flags.service_images) {
  matrix.service_images.include.push({ label: 'Build service images' });
}
// Jobs that download the SDK artifacts (sdk-artifacts action) need them built.
flags.build_sdks ||=
  flags.image_verifier_bot ||
  flags.verifier_bot_tests ||
  flags.web_image ||
  flags.eas_store ||
  release;
flags.build_rn_sdk ||= flags.web_image || flags.eas_store || release;

// Outputs -------------------------------------------------------------------

const out = (name, value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  appendFileSync(env.GITHUB_OUTPUT, `${name}=${text}\n`);
  console.log(`${name}=${text}`);
};
out('registry', env.REGISTRY);
out('ref_slug', refSlug);
// CI images are tagged by the content of .gitlab/images; unchanged inputs
// mean an existing tag and no build.
out('images_tag', git('rev-parse', 'HEAD:.gitlab/images').slice(0, 12));
out('default_branch', defaultBranch);
out('is_tag', isTag);
out('default_ref', defaultRef);
out('plan', { flags, matrix });
