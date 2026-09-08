// Creates (or updates) the Forgejo release for the tag and attaches assets.
//
//   node release.mjs <notes-file> [name=path ...]
//
// Env: GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_REF_NAME, GITHUB_SHA, GITHUB_TOKEN.

import { readFileSync } from 'node:fs';

const [notesFile, ...assets] = process.argv.slice(2);
const tag = process.env.GITHUB_REF_NAME;
const base = `${process.env.GITHUB_API_URL}/repos/${process.env.GITHUB_REPOSITORY}/releases`;
const headers = { Authorization: `token ${process.env.GITHUB_TOKEN}` };

async function api(path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`,
    );
  }
  return res;
}

const body = readFileSync(notesFile, 'utf8');
const release = {
  tag_name: tag,
  target_commitish: process.env.GITHUB_SHA,
  name: tag,
  body,
  prerelease: tag.includes('-'),
};

const existing = await api(`/tags/${encodeURIComponent(tag)}`);
let id;
if (existing.status === 200) {
  id = (await existing.json()).id;
  await api(`/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(release),
  });
  console.log(`Updated release ${tag} (#${id})`);
} else {
  const res = await api('', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(release),
  });
  id = (await res.json()).id;
  console.log(`Created release ${tag} (#${id})`);
}

const current = await (await api(`/${id}/assets`)).json();
for (const asset of assets) {
  const eq = asset.indexOf('=');
  const name = eq > 0 ? asset.slice(0, eq) : asset.split('/').pop();
  const file = eq > 0 ? asset.slice(eq + 1) : asset;
  for (const old of current.filter((a) => a.name === name)) {
    await api(`/${id}/assets/${old.id}`, { method: 'DELETE' });
  }
  const form = new FormData();
  form.append('attachment', new Blob([readFileSync(file)]), name);
  await api(`/${id}/assets?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    body: form,
  });
  console.log(`Attached ${name}`);
}
