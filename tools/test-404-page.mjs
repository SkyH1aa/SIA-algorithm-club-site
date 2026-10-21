// Offline: node tools/test-404-page.mjs
// GitHub Pages serves the repository-root 404.html for unknown paths, so the file
// must live at the repo root (not public/) and every asset/link must resolve to the
// project-page root no matter how deep the original URL was.
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootPage = path.join(root, '404.html');

// 1) GitHub Pages only honours a repository-root 404.html.
assert.ok((await stat(rootPage)).isFile(), '404.html must exist at the repository root');
await assert.rejects(stat(path.join(root, 'public', '404.html')), /ENOENT/, 'public/404.html must not be the deployed 404');

const html = await readFile(rootPage, 'utf8');

// 2) Every asset reference is repo-root-relative ("public/..."), never "/public/...".
for (const match of html.matchAll(/(?:src|href)="(\/[^"]*)"/g)) {
  assert.fail(`root-absolute reference breaks project pages: ${match[1]}`);
}
for (const needed of ['public/theme.css', 'public/club-ui.css', 'public/club-common.js', 'public/i18n.js', 'public/club-shell.js', 'public/favicon.svg']) {
  assert.ok(html.includes(needed), `404 page references ${needed}`);
}
assert.ok(!html.includes('/index.html'), 'home links must not assume the account root');
assert.ok(html.includes('href="index.html"'), 'home links resolve through <base>');

// 3) `<base>` derivation must map every deployment shape to the site root.
const script = html.match(/<script>\s*\(function \(\) \{[\s\S]*?<\/script>/)[0]
  .replace(/^<script>/, '').replace(/<\/script>$/, '');
const baseFor = (protocol, hostname, pathname) => {
  let written = null;
  const document = { write: value => { written = value; } };
  const location = { protocol, hostname, pathname };
  vm.runInNewContext(script, { location, document, RegExp });
  const match = /<base href="([^"]*)">/.exec(written || '');
  return match ? match[1] : null;
};
assert.equal(baseFor('https:', 'skyh1aa.github.io', '/SIA-algorithm-club-site/'), '/SIA-algorithm-club-site/');
assert.equal(baseFor('https:', 'skyh1aa.github.io', '/SIA-algorithm-club-site/a/b/nope'), '/SIA-algorithm-club-site/');
assert.equal(baseFor('https:', 'skyh1aa.github.io', '/SIA-algorithm-club-site/nope.html'), '/SIA-algorithm-club-site/');
assert.equal(baseFor('https:', 'skyh1aa.github.io', '/'), '/', 'user-site root falls back to /');
assert.equal(baseFor('https:', 'club.example.com', '/a/b'), '/', 'custom domain uses /');
assert.equal(baseFor('file:', '', '/D:/site/404.html'), './', 'local file opens relative');

// 4) The versioning tool must keep covering the root 404.
const versioner = await readFile(path.join(root, 'tools', 'version-static-assets.mjs'), 'utf8');
assert.match(versioner, /path\.join\(root, '404\.html'\)/, 'version tool covers the root 404');
const manifest = JSON.parse(await readFile(path.join(root, 'public', 'asset-versions.json'), 'utf8'));
const themeHash = manifest.hashes['theme.css'];
assert.ok(themeHash, 'theme.css is content-hashed');
assert.match(html, new RegExp(`public/theme\\.css\\?v=${themeHash}`), '404 page carries the current theme hash');

console.log('404 page: repo-root location, project-page-safe base resolution, no account-root links, versioned assets passed.');
