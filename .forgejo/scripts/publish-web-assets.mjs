// Upload an exported web bundle to the static bucket:
//   node publish-web-assets.mjs <srcDir> <destPrefix> [baseUrl]
// Filenames are content-hashed, so uploads are additive and immutable; files
// the bucket already holds with the same content are skipped.
//
// With baseUrl, root-relative asset URLs baked into the js/css are
// rewritten to absolute ones (in place, the extracted tree is throwaway)
// so the bundle pulls fonts, images and wasm from the bucket too.
// server.js applies the same rewrite to the HTML it serves.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createStaticBucket } from '../../tools/static-bucket/index.js';

const [srcDir, destPrefix, baseUrl] = process.argv.slice(2);
if (!srcDir || !destPrefix) {
  console.error(
    'usage: publish-web-assets.mjs <srcDir> <destPrefix> [baseUrl]',
  );
  process.exit(1);
}

const bucket = createStaticBucket();
const base = baseUrl?.replace(/\/$/, '');

const CONTENT_TYPES = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Only a quote starts a URL; `expo-router/assets/` and `common/assets/`
// also contain the substring as an inner path segment. `twemoji/` is the
// `public/` tree the app loads at runtime (TWEMOJI_URL).
function rewriteAssetUrls(file) {
  const source = readFileSync(file, 'utf8');
  const rewritten = source.replace(
    /(["'])\/(assets|twemoji)\//g,
    `$1${base}/$2/`,
  );
  if (rewritten !== source) writeFileSync(file, rewritten);
}

const CONCURRENCY = 16;

const files = readdirSync(srcDir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.join(entry.parentPath, entry.name));
if (files.length === 0) {
  console.error(`no files found under ${srcDir}`);
  process.exit(1);
}

let uploaded = 0;
let skipped = 0;
async function publish(file) {
  const ext = path.extname(file);
  if (base && (ext === '.js' || ext === '.css')) rewriteAssetUrls(file);
  const relative = path.relative(srcDir, file).split(path.sep).join('/');
  const key = `${destPrefix}/${relative}`;
  const md5 = createHash('md5').update(readFileSync(file)).digest('hex');
  const existing = await bucket.head(key);
  if (existing?.etag === md5) {
    skipped += 1;
    return;
  }
  await bucket.put(
    key,
    file,
    CONTENT_TYPES[ext] || 'application/octet-stream',
    'public, max-age=31536000, immutable',
  );
  uploaded += 1;
}

const queue = [...files];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      await publish(file);
    }
  }),
);

console.log(
  `published ${uploaded} files to ${destPrefix}/ (${skipped} already there)`,
);
