// Offline: node tools/test-asset-versions.mjs
// Verifies every shared asset reference carries the current content hash and that
// the versioning script is idempotent.
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');

const manifest = JSON.parse(await readFile(path.join(publicDir, 'asset-versions.json'), 'utf8'));
assert.equal(manifest.generated_by, 'tools/version-static-assets.mjs');
const hashes = manifest.hashes;
assert.ok(Object.keys(hashes).length >= 15, 'expected the shared asset set to be hashed');

for (const [name, digest] of Object.entries(hashes)) {
  assert.match(digest, /^[0-9a-f]{8}$/, `${name} hash format`);
  const file = path.join(publicDir, name);
  assert.ok((await stat(file)).isFile(), `${name} exists`);
  const actual = crypto.createHash('sha256').update(await readFile(file)).digest('hex').slice(0, 8);
  assert.equal(actual, digest, `${name} manifest hash matches file`);
}

const htmlFiles = [
  path.join(root, 'index.html'),
  ...(await readdir(publicDir)).filter(name => name.endsWith('.html')).map(name => path.join(publicDir, name)),
  ...['俄罗斯方块.html', '俄罗斯方块AI.html', '贪吃蛇.html', '贪吃蛇专家系统.html']
    .map(name => path.join(root, name))
];

let checked = 0;
for (const file of htmlFiles) {
  let source;
  try { source = await readFile(file, 'utf8'); } catch { continue; }
  for (const match of source.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)) {
    const url = match[1];
    if (/^https?:/i.test(url)) continue;
    const base = url.split('?')[0].replace(/^\.\//, '').replace(/^public\//, '').split('/').pop();
    if (base === 'supabase.min.js') {
      const expected = hashes['vendor/supabase/supabase.min.js'];
      assert.match(url, new RegExp(`[?&]v=${expected}$`), `${path.relative(root, file)} supabase version`);
      checked++;
    }
  }
  for (const match of source.matchAll(/<link\b[^>]*\bhref="([^"]+\.css[^"]*)"/g)) {
    const url = match[1];
    const base = url.split('?')[0].replace(/^\.\//, '').replace(/^public\//, '');
    const name = Object.keys(hashes).find(item => item === base || path.basename(item) === path.basename(base));
    if (!name) continue;
    assert.match(url, new RegExp(`[?&]v=${hashes[name]}$`), `${path.relative(root, file)} ${name} version`);
    checked++;
  }
}
assert.ok(checked >= 30, `expected many versioned references, saw ${checked}`);

// Running --check must not rewrite anything.
const before = await readFile(path.join(publicDir, 'donations.html'), 'utf8');
execFileSync(process.execPath, [path.join(root, 'tools/version-static-assets.mjs'), '--check'], { cwd: root, stdio: 'pipe' });
const after = await readFile(path.join(publicDir, 'donations.html'), 'utf8');
assert.equal(after, before, '--check is read-only');

console.log(`PASS asset versions: ${Object.keys(hashes).length} hashed assets, ${checked} references match, --check read-only.`);
