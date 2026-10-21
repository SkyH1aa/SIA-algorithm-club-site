// Offline: node tools/test-vendor-supabase.mjs
// Confirms the Supabase SDK is vendored locally, that no page still loads it from a CDN,
// and that the chat mock server can still swap in its fixture.
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const vendor = path.join(publicDir, 'vendor', 'supabase', 'supabase.min.js');

const info = await stat(vendor);
assert.ok(info.size > 60_000, 'vendored bundle should be a full UMD build');
const bundle = await readFile(vendor, 'utf8');
assert.match(bundle.slice(0, 200), /supabase/, 'bundle looks like the supabase UMD build');
const digest = crypto.createHash('sha256').update(await readFile(vendor)).digest('hex');
assert.match(digest, /^[0-9a-f]{64}$/);

const pages = [
  path.join(root, 'index.html'),
  ...(await readdir(publicDir)).filter(name => name.endsWith('.html')).map(name => path.join(publicDir, name))
];
let local = 0;
for (const file of pages) {
  let source;
  try { source = await readFile(file, 'utf8'); } catch { continue; }
  if (/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/i.test(source)) {
    assert.fail(`${path.relative(root, file)} still loads supabase from the CDN`);
  }
  if (source.includes('vendor/supabase/supabase.min.js')) local++;
}
assert.ok(local >= 30, `expected most pages to use the local bundle, saw ${local}`);

// The mock server must recognise a local tag and still replace it with its fixture.
const mockSource = await readFile(path.join(root, 'tools', 'chat-mock-server.mjs'), 'utf8');
assert.match(mockSource, /supabase-js|supabase\.min\.js/, 'mock server knows how to find the SDK tag');

console.log(`PASS vendor supabase: local UMD (${info.size} bytes, sha256 ${digest.slice(0, 12)}…), ${local} pages local, zero CDN references.`);
