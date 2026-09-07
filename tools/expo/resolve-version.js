#!/usr/bin/env node
// Resolves the app version for EAS builds, writes it into
// apps/harbor/package.json, and prints it to stdout.
//
//   * On a SemVer release tag (e.g. v2.0.0-alpha.1) -> that version
//     (2.0.0-alpha.1).
//   * Otherwise -> the latest GitLab release version with the patch bumped
//     (e.g. latest 2.0.0 -> 2.0.1), so develop/MR builds sit one patch ahead
//     of the last release.
//
// The version is baked into package.json (not just exported as APP_VERSION)
// because EAS evaluates app.config.ts on a remote build worker that does not
// receive the CI runner's environment variables. app.config.ts reads the
// version from package.json, which travels with the project upload.
//
// Reads CI_COMMIT_TAG and either CI_API_V4_URL, CI_PROJECT_ID, CI_JOB_TOKEN
// (GitLab) or GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_TOKEN (Forgejo).

const fs = require('fs');
const path = require('path');

const PKG_PATH = path.join(
  __dirname,
  '..',
  '..',
  'apps',
  'harbor',
  'package.json',
);

const apply = (version) => {
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
  process.stdout.write(version);
};

const tag = process.env.CI_COMMIT_TAG || '';
const tagMatch = tag.match(/^v(\d+\.\d+\.\d+.*)$/);

if (tagMatch) {
  apply(tagMatch[1]);
} else {
  const api = process.env.CI_API_V4_URL;
  const projectId = process.env.CI_PROJECT_ID;
  const token = process.env.CI_JOB_TOKEN;

  const bumpPatch = (version) => {
    const core = String(version).replace(/^v/, '').split('-')[0];
    const [major = '0', minor = '0', patch = '0'] = core.split('.');
    return `${major}.${minor}.${Number(patch) + 1}`;
  };

  (async () => {
    let latest = '0.0.0';
    try {
      let url = `${api}/projects/${projectId}/releases?per_page=1`;
      let headers = { 'JOB-TOKEN': token };
      if (process.env.GITHUB_REPOSITORY) {
        url = `${process.env.GITHUB_API_URL}/repos/${process.env.GITHUB_REPOSITORY}/releases?limit=1`;
        headers = { Authorization: `token ${process.env.GITHUB_TOKEN}` };
      }
      const res = await fetch(url, { headers });
      if (res.ok) {
        const releases = await res.json();
        if (Array.isArray(releases) && releases[0]) {
          latest = releases[0].tag_name || releases[0].name || latest;
        }
      }
    } catch {
      // Fall back to the default below.
    }
    apply(bumpPatch(latest));
  })();
}
