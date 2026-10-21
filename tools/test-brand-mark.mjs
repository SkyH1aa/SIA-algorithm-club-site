// Offline: node tools/test-brand-mark.mjs
// The site logo is the letter A (Algorithm), in the header badge and the favicon.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');

const files = [
  path.join(root, 'index.html'),
  path.join(root, '404.html'),
  ...(await readdir(publicDir)).filter(name => name.endsWith('.html')).map(name => path.join(publicDir, name))
];

const seen = new Map();
for (const file of files) {
  const html = await readFile(file, 'utf8');
  for (const match of html.matchAll(/<span class="brand-mark"[^>]*>([^<]*)<\/span>/g)) {
    const mark = match[1].trim();
    assert.equal(mark, 'A', `${path.relative(root, file)} brand mark must be A, found "${mark}"`);
    seen.set(path.relative(root, file), mark);
  }
}
assert.ok(seen.size >= 30, `expected every page to carry the brand mark, saw ${seen.size}`);

const icon = await readFile(path.join(publicDir, 'favicon.svg'), 'utf8');
assert.match(icon, /aria-label="Algorithm Club"/);
// The glyph is drawn as an A: two diagonals meeting at the apex plus a crossbar.
assert.match(icon, /<path d="M32 13 15 51/, 'favicon should draw an A shape');
assert.doesNotMatch(icon, /M18 44V20h8l6 12/, 'old M glyph must be gone');

console.log(`Brand mark: A on ${seen.size} pages, favicon draws A.`);
