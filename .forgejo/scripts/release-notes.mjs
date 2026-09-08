// Release notes from `Changelog:` commit trailers since the previous release
// tag, grouped like .gitlab/changelog_config.yml. Needs the full history.
//
//   node release-notes.mjs [output-file]
//
// Env: GITHUB_REF_NAME (the tag), GITHUB_SERVER_URL, GITHUB_REPOSITORY.

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
const repoUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}`;
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
  '--format=%H%x1f%s%x1f%(trailers:key=Changelog,valueonly)%x1e',
  previous ? `${previous}..${tag}` : tag,
);

const entries = new Map();
for (const record of log.split(RECORD)) {
  const [sha, subject, trailer] = record.trim().split(FIELD);
  if (!sha || !trailer?.trim()) continue;
  const category = trailer.trim().split('\n')[0].trim().toLowerCase();
  const key = category in CATEGORIES ? category : 'other';
  const list = entries.get(key) ?? [];
  list.push(`- ${subject} ([${sha.slice(0, 8)}](${repoUrl}/commit/${sha}))`);
  entries.set(key, list);
}

let notes = 'No changes.\n';
if (entries.size > 0) {
  notes = Object.entries(CATEGORIES)
    .filter(([key]) => entries.has(key))
    .map(([key, title]) => `#### ${title}\n\n${entries.get(key).join('\n')}\n`)
    .join('\n');
}

writeFileSync(process.argv[2] ?? 'release_notes.md', notes);
process.stdout.write(notes);
