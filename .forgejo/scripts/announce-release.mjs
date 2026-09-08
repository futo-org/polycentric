// Posts the release to the Mattermost releases channel.
//
//   node announce-release.mjs [notes-file]
//
// Env: GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_REF_NAME, MATTERMOST_RELEASES_WEBHOOK.

import { readFileSync } from 'node:fs';

const tag = process.env.GITHUB_REF_NAME;
const url = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/releases/tag/${tag}`;
const notes = readFileSync(process.argv[2] ?? 'release_notes.md', 'utf8');

const res = await fetch(process.env.MATTERMOST_RELEASES_WEBHOOK, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    text: `### [Harbor ${tag}](${url}) released\n\n${notes.slice(0, 6000)}`,
  }),
});
if (!res.ok) {
  console.error(`Mattermost webhook: ${res.status} ${await res.text()}`);
  process.exit(1);
}
