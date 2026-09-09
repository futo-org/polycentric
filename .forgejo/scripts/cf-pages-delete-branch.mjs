// Attempt a teardown of all Cloudflare Pages preview deployments for a
// single branch. Used by the docs review-app stop job (deploy_docs.yml) when a
// merge request is merged/closed or its environment is auto-stopped.

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const project = process.env.CF_PAGES_PROJECT;
const branch = process.env.CF_PAGES_BRANCH;

for (const [name, value] of Object.entries({
  CLOUDFLARE_API_TOKEN: token,
  CLOUDFLARE_ACCOUNT_ID: account,
  CF_PAGES_PROJECT: project,
  CF_PAGES_BRANCH: branch,
})) {
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
}

const base = `https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/${project}`;
const headers = { Authorization: `Bearer ${token}` };

async function cf(path, init) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...headers, ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    throw new Error(
      `Cloudflare API ${res.status}: ${JSON.stringify(body.errors ?? body)}`,
    );
  }
  return body;
}

// There may be multiple deployments per branch. Wrangler has no function to delete all
// deployments, so we delete one-by-one.

// Deployments are paginated; walk pages until we stop getting results.
async function* deployments() {
  for (let page = 1; ; page++) {
    const { result } = await cf(`/deployments?per_page=25&page=${page}`);
    if (!result || result.length === 0) return;
    yield* result;
    if (result.length < 25) return;
  }
}

let deleted = 0;
let failed = 0;
for await (const d of deployments()) {
  const depBranch = d.deployment_trigger?.metadata?.branch;
  if (depBranch !== branch) continue;
  try {
    // force=true also removes deployments that are currently "live" for an alias.
    await cf(`/deployments/${d.id}?force=true`, { method: 'DELETE' });
    deleted++;
    console.log(`Deleted deployment ${d.id} (branch ${branch})`);
  } catch (err) {
    failed++;
    console.error(`Failed to delete deployment ${d.id}: ${err.message}`);
  }
}

console.log(`Done: ${deleted} deleted, ${failed} failed for branch ${branch}.`);
process.exit(0);
