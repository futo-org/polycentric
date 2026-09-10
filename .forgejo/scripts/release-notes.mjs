// Release notes in the shape GitLab's changelog API produced: commits since
// the previous release tag that carry a `Changelog: <category>` line, grouped
// by category (.gitlab/changelog_config.yml, now inlined here). The line is
// read from anywhere in the commit body, not only the trailer paragraph: the
// squash template puts the PR description (where people write it) above
// Reviewed-on. Needs the full history.
//
//   node release-notes.mjs [output-file]
//
// Env: GITHUB_REF_NAME (the tag), GITHUB_REPOSITORY, GITHUB_API_URL and
// GITHUB_TOKEN (author lookups; without a token nobody is credited).

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CATEGORIES = {
  feature: '🚀 Features',
  fix: '🐛 Bug fixes',
  enhancement: '⚡ Enhancements',
  security: '🔒 Security',
  deprecated: '⚠️ Deprecated',
  'breaking-change': '🚨 Breaking Changes',
  documentation: '📚 Documentation',
  other: '📦 Other',
};

const tag = process.env.GITHUB_REF_NAME;
const repo = process.env.GITHUB_REPOSITORY;
const api = process.env.GITHUB_API_URL;
const token = process.env.GITHUB_TOKEN;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

let previous = '';
try {
  previous = git(
    'describe',
    '--tags',
    '--abbrev=0',
    '--match',
    'v[0-9]*',
    `${tag}^`,
  ).trim();
} catch {
  // First release.
}

const FIELD = '\x1f';
const RECORD = '\x1e';
const log = git(
  'log',
  `--format=%H${FIELD}%s${FIELD}%b${RECORD}`,
  previous ? `${previous}..${tag}` : tag,
);

// Members of the repo (write or better) are not credited, like GitLab's
// `author.contributor`. Cached per login; a failed lookup credits nobody.
const membership = new Map();
async function get(path) {
  if (!api || !token) return null;
  const res = await fetch(`${api}/repos/${repo}${path}`, {
    headers: { Authorization: `token ${token}` },
  });
  return res.ok ? res.json() : null;
}
async function contributor(sha) {
  const commit = await get(`/git/commits/${sha}`);
  const login = commit?.author?.login;
  if (!login) return '';
  if (!membership.has(login)) {
    const perm = await get(
      `/collaborators/${encodeURIComponent(login)}/permission`,
    );
    membership.set(
      login,
      ['write', 'admin', 'owner'].includes(perm?.permission),
    );
  }
  return membership.get(login) ? '' : ` by @${login}`;
}

const entries = new Map();
for (const record of log.split(RECORD)) {
  const [sha, subject, body = ''] = record.trim().split(FIELD);
  const category = body.match(/^Changelog:[ \t]*(\S+)/im)?.[1].toLowerCase();
  if (!sha || !category) continue;
  const pr = body.match(/^Reviewed-on:[ \t]*(\S+)/im)?.[1];
  const line =
    `- ${subject} (${repo}@${sha})` +
    (await contributor(sha)) +
    (pr ? ` ([pull request](${pr}))` : '');
  const list = entries.get(category) ?? [];
  list.push(line);
  entries.set(category, list);
}

const version = tag.replace(/^v/, '');
const date = new Date().toISOString().slice(0, 10);
let notes = `## ${version} (${date})\n\n`;
if (entries.size === 0) {
  notes += 'No changes.\n';
} else {
  // Configured categories first, in order; unknown ones after, by name.
  const order = [
    ...Object.keys(CATEGORIES).filter((key) => entries.has(key)),
    ...[...entries.keys()].filter((key) => !(key in CATEGORIES)).sort(),
  ];
  for (const key of order) {
    notes += `#### ${CATEGORIES[key] ?? key}\n\n${entries.get(key).join('\n')}\n`;
  }
}

writeFileSync(process.argv[2] ?? 'release_notes.md', notes);
process.stdout.write(notes);
