// Publish an APK and its update manifest to the static bucket:
//   apk/<channel>/harbor-v<version>-<code>.apk   (immutable)
//   apk/<channel>/harbor-latest.apk              (stable download link)
//   apk/<channel>/latest.json                    (polled by the app)
//
// Reads apps/harbor/{eas-build.json,harbor.apk} and release_notes.md
// (production tags only) from earlier jobs' artifacts.
//
// Env: UPDATE_CHANNEL (staging|production), STATIC_PUBLIC_BASE_URL, and
// the STATIC_S3_* variables read by tools/static-bucket.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createStaticBucket } from '../../../tools/static-bucket/index.js';

const channel = process.env.UPDATE_CHANNEL;
if (channel !== 'staging' && channel !== 'production') {
  console.error(`UPDATE_CHANNEL must be staging or production, got ${channel}`);
  process.exit(1);
}
const publicBaseUrl = process.env.STATIC_PUBLIC_BASE_URL?.replace(/\/$/, '');
if (!publicBaseUrl) {
  console.error('missing required env var STATIC_PUBLIC_BASE_URL');
  process.exit(1);
}

const bucket = createStaticBucket();

// `eas build --json` emits an array of builds.
const easOutput = JSON.parse(
  readFileSync('apps/harbor/eas-build.json', 'utf8'),
);
const build = Array.isArray(easOutput) ? easOutput[0] : easOutput;
const versionName = build?.appVersion;
const versionCode = Number(build?.appBuildVersion);
if (!versionName || !Number.isInteger(versionCode) || versionCode <= 0) {
  console.error(
    `could not read appVersion/appBuildVersion from eas-build.json ` +
      `(got ${build?.appVersion} / ${build?.appBuildVersion})`,
  );
  process.exit(1);
}

const notes = existsSync('release_notes.md')
  ? readFileSync('release_notes.md', 'utf8').trim()
  : `${process.env.CI_COMMIT_SHORT_SHA ?? ''}: ${process.env.CI_COMMIT_TITLE ?? ''}`.trim();

const apkFile = 'apps/harbor/harbor.apk';
const apkKey = `apk/${channel}/harbor-v${versionName}-${versionCode}.apk`;
const latestApkKey = `apk/${channel}/harbor-latest.apk`;
const manifestKey = `apk/${channel}/latest.json`;

const manifest = {
  package:
    channel === 'production'
      ? 'org.futo.polycentric'
      : `org.futo.polycentric.${channel}`,
  channel,
  versionName,
  versionCode,
  url: `${publicBaseUrl}/${apkKey}`,
  sha256: createHash('sha256').update(readFileSync(apkFile)).digest('hex'),
  notes,
  publishedAt: new Date().toISOString(),
};
writeFileSync('latest.json', `${JSON.stringify(manifest, null, 2)}\n`);

const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';

bucket.put(
  apkKey,
  apkFile,
  APK_CONTENT_TYPE,
  'public, max-age=31536000, immutable',
);
bucket.put(latestApkKey, apkFile, APK_CONTENT_TYPE, 'public, max-age=300');
// Manifest goes last so it never points at an APK that isn't there yet.
bucket.put(
  manifestKey,
  'latest.json',
  'application/json',
  'public, max-age=300',
);

console.log(`published ${manifest.url}`);
