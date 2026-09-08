#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { SEEDED_USERS, seed } from './seed.mjs';
import { startVerifyServer } from './verify.mjs';

const PLATFORMS = ['ios', 'android', 'web'];
const APP_ID = process.env.MAESTRO_APP_ID ?? 'org.futo.polycentric.dev';
const FLOWS = new URL('.', import.meta.url).pathname;
const WEB_URL = process.env.MAESTRO_WEB_URL ?? 'http://localhost:8081';
// A fixed report directory instead of a timestamped one, for CI artifacts.
const OUTPUT = process.env.MAESTRO_OUTPUT
  ? [`--output=${process.env.MAESTRO_OUTPUT}`, '--flatten']
  : [];
// Flows tagged `flaky` are skipped until fixed.
const EXCLUDE = ['--exclude-tags=flaky'];

const platform = process.argv[2];
if (platform && !PLATFORMS.includes(platform)) {
  console.error(`Usage: run.mjs [${PLATFORMS.join('|')}] [flow name]`);
  process.exit(2);
}

// A single flow by name, looked up in the platform's directory.
const FLOW = process.argv.slice(3).find((arg) => !arg.startsWith('--'));
const flowsFor = (dir) =>
  FLOW
    ? `${FLOWS}${dir}/${FLOW.replace(/(\.yaml)?$/, '.yaml')}`
    : `${FLOWS}${dir}`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function read(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// Async so the verify helper can answer the flows while Maestro runs.
async function run(command, args) {
  const child = spawn(command, args, { stdio: 'inherit' });
  const status = await new Promise((resolve) => child.on('exit', resolve));
  process.exit(status ?? 1);
}

// The android path shells out to the JVM maestro CLI, which needs JAVA_HOME
// (Homebrew's JDK is keg-only) and warning flags for recent JDKs.
function setupJava() {
  if (!process.env.JAVA_HOME) {
    try {
      execFileSync('java', ['-version'], { stdio: 'ignore' });
    } catch {
      try {
        process.env.JAVA_HOME = execFileSync('brew', ['--prefix', 'openjdk'], {
          encoding: 'utf8',
        }).trim();
      } catch {
        fail('No Java runtime. Install one with `brew install openjdk`.');
      }
    }
  }

  const java = process.env.JAVA_HOME
    ? `${process.env.JAVA_HOME}/bin/java`
    : 'java';
  const banner = spawnSync(java, ['-version'], { encoding: 'utf8' }).stderr;
  const major = Number.parseInt(
    banner?.match(/version "(\d+)/)?.[1] ?? '0',
    10,
  );
  const opts = [
    ...(major >= 23 ? ['--sun-misc-unsafe-memory-access=allow'] : []),
    ...(major >= 26 ? ['--enable-final-field-mutation=ALL-UNNAMED'] : []),
  ];
  if (opts.length > 0) {
    process.env.MAESTRO_OPTS = [process.env.MAESTRO_OPTS, ...opts]
      .filter(Boolean)
      .join(' ');
  }
}

function chooseDevice() {
  const devices = JSON.parse(
    execFileSync(
      'maestro-runner',
      [...(platform ? ['--platform', platform] : []), 'devices', '--json'],
      { encoding: 'utf8' },
    ),
  ).filter((device) => device.ready);

  if (process.env.MAESTRO_DEVICE) {
    const id = process.env.MAESTRO_DEVICE;
    return (
      devices.find((device) => device.id === id) ?? {
        id,
        platform,
        kind: 'device',
      }
    );
  }
  if (devices.length === 0) {
    fail(
      `Nothing to run on. Plug in a phone, or start ${platform === 'android' ? 'an emulator' : 'a simulator'}.`,
    );
  }
  if (new Set(devices.map((device) => device.platform)).size > 1) {
    fail('Both platforms are connected. Run test:ios or test:android.');
  }

  // Prefer a plugged-in phone over a booted simulator; `--simulator` flips it.
  const chosen =
    devices.find((device) =>
      process.argv.includes('--simulator')
        ? device.kind !== 'device'
        : device.kind === 'device',
    ) ?? devices[0];
  console.log(`Running on ${chosen.name} (${chosen.kind})`);
  return chosen;
}

// WebDriverAgent is signed onto a physical device with the app's team.
function resolveTeamId() {
  if (process.env.APPLE_TEAM_ID) return process.env.APPLE_TEAM_ID;
  const ios = new URL('../apps/harbor/ios/', import.meta.url);
  for (const entry of read(ios)) {
    if (!entry.endsWith('.xcodeproj')) continue;
    try {
      const project = readFileSync(
        new URL(`${entry}/project.pbxproj`, ios),
        'utf8',
      );
      const team = project.match(/DEVELOPMENT_TEAM = "?([A-Z0-9]+)"?;/)?.[1];
      if (team) return team;
    } catch {}
  }
  return undefined;
}

function bundleIdOf(app) {
  try {
    return execFileSync(
      '/usr/libexec/PlistBuddy',
      ['-c', 'Print :CFBundleIdentifier', `${app}/Info.plist`],
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return undefined;
  }
}

// clearState reinstalls on a physical iPhone, so the binary has to be on the
// host. `pnpm -C apps/harbor ios:e2e` leaves one in DerivedData.
function findLocalAppBundle() {
  const root = `${homedir()}/Library/Developer/Xcode/DerivedData`;
  const candidates = [];

  for (const entry of read(root)) {
    const products = `${root}/${entry}/Build/Products`;
    for (const config of read(products)) {
      if (!config.endsWith('-iphoneos')) continue;
      for (const app of read(`${products}/${config}`)) {
        if (!app.endsWith('.app')) continue;
        const path = `${products}/${config}/${app}`;
        candidates.push({ path, time: statSync(path).mtimeMs });
      }
    }
  }

  // Only a Release build carries its own JS bundle, so prefer one.
  candidates.sort(
    (a, b) =>
      Number(b.path.includes('/Release-')) -
        Number(a.path.includes('/Release-')) || b.time - a.time,
  );
  return candidates.find(({ path }) => bundleIdOf(path) === APP_ID)?.path;
}

function iosArgs(device) {
  const teamId = resolveTeamId();
  const app =
    process.env.MAESTRO_APP_FILE ??
    (device.kind === 'device' ? findLocalAppBundle() : undefined);

  return [
    '--platform=ios',
    `--device=${device.id}`,
    ...(teamId ? [`--team-id=${teamId}`] : []),
    ...(app ? [`--app-file=${app}`] : []),
  ];
}

// Users the flows search for must exist on the server under test, and the
// flows act as them through the verify helper.
const client = await seed();
const flowEnvs = [
  ...Object.entries(SEEDED_USERS).map(([k, v]) => `${k}=${v}`),
  `MAESTRO_VERIFY_URL=${await startVerifyServer(client)}`,
].flatMap((kv) => ['-e', kv]);

// Web goes through maestro-runner too: Maestro's own web driver is in beta
// and leaves its browser open, so the process never exits.
if (platform === 'web') {
  await run('maestro-runner', [
    '--platform=web',
    'test',
    ...OUTPUT,
    ...EXCLUDE,
    '-e',
    `MAESTRO_WEB_URL=${WEB_URL}`,
    ...flowEnvs,
    flowsFor('web'),
  ]);
}

const device = chooseDevice();
const flags = [
  ...EXCLUDE,
  '-e',
  `MAESTRO_APP_ID=${APP_ID}`,
  ...flowEnvs,
  flowsFor('native'),
];
if (device.platform === 'android') {
  setupJava();
  await run('maestro', [
    '--platform',
    'android',
    '--device',
    device.id,
    'test',
    ...flags,
  ]);
}
await run('maestro-runner', [...iosArgs(device), 'test', ...OUTPUT, ...flags]);
