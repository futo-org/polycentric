// Upload an exported web bundle to the static bucket:
//   node publish-web-assets.mjs <srcDir> <destPrefix> [baseUrl]
// Filenames are content-hashed, so uploads are additive and immutable.
//
// With baseUrl, root-relative asset URLs baked into the js/css are
// rewritten to absolute ones (in place, the extracted tree is throwaway)
// so the bundle pulls fonts, images and wasm from the bucket too.
// server.js applies the same rewrite to the HTML it serves.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createStaticBucket } from '../../../tools/static-bucket/index.js';

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
// also contain the substring as an inner path segment.
function rewriteAssetUrls(file) {
  const source = readFileSync(file, 'utf8');
  const rewritten = source.replaceAll('"/assets/', `"${base}/assets/`);
  if (rewritten !== source) writeFileSync(file, rewritten);
}

let uploaded = 0;
for (const entry of readdirSync(srcDir, {
  recursive: true,
  withFileTypes: true,
})) {
  if (!entry.isFile()) continue;
  const file = path.join(entry.parentPath, entry.name);
  const ext = path.extname(entry.name);
  if (base && (ext === '.js' || ext === '.css')) rewriteAssetUrls(file);
  const relative = path.relative(srcDir, file).split(path.sep).join('/');
  bucket.put(
    `${destPrefix}/${relative}`,
    file,
    CONTENT_TYPES[ext] || 'application/octet-stream',
    'public, max-age=31536000, immutable',
  );
  uploaded += 1;
}

if (uploaded === 0) {
  console.error(`no files found under ${srcDir}`);
  process.exit(1);
}
console.log(`published ${uploaded} files to ${destPrefix}/`);
