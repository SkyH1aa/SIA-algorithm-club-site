// Offline: node tools/test-seo.mjs
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFile(path.join(root, name), 'utf8');
const SITE = 'https://skyh1aa.github.io/SIA-algorithm-club-site';

// --- share image: WeChat/QQ need a raster image, not SVG ---
const image = await stat(path.join(root, 'public/assets/og-cover.png'));
assert.ok(image.size > 10_000, 'share image exists and is non-trivial');
const png = await readFile(path.join(root, 'public/assets/og-cover.png'));
assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'valid PNG header');
// IHDR width/height (big-endian at bytes 16..24).
assert.equal(png.readUInt32BE(16), 1200, 'share image is 1200px wide');
assert.equal(png.readUInt32BE(20), 630, 'share image is 630px tall');

// --- sitemap / robots ---
const sitemap = await read('public/sitemap.xml');
assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
assert.ok(locs.length >= 15, `sitemap lists the public pages (${locs.length})`);
for (const loc of locs) assert.ok(loc.startsWith(SITE), `sitemap URL is absolute: ${loc}`);

const robots = await read('public/robots.txt');
assert.match(robots, /Sitemap: .*\/sitemap\.xml/);
assert.match(robots, /Disallow: \/predelete\//, 'predelete is not indexable');
assert.match(robots, /Disallow: \/docs\//, 'docs are not indexable');

// --- per-page meta on the new pages ---
for (const [file, expected] of [
  ['public/notifications.html', '/public/notifications.html'],
  ['public/member-profile.html', '/public/member-profile.html'],
  ['public/search.html', '/public/search.html'],
  ['public/donations.html', '/public/donations.html'],
  ['index.html', '/index.html']
]) {
  const html = await read(file);
  assert.match(html, /<meta name="description" content="[^"]{20,}"/, `${file} has a description`);
  assert.match(html, /property="og:title"/, `${file} has og:title`);
  assert.match(html, /property="og:description"/, `${file} has og:description`);
  assert.match(html, /property="og:image" content="[^"]*og-cover\.png"/, `${file} shares the cover image`);
  assert.match(html, /property="og:url" content="[^"]+"/, `${file} has og:url`);
  assert.match(html, /name="twitter:card" content="summary_large_image"/, `${file} has a Twitter card`);
  assert.match(html, new RegExp(`rel="canonical" href="${SITE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
    `${file} canonical points at the project page`);
}

console.log(`SEO: ${locs.length}-URL sitemap, robots exclusions, 1200×630 PNG cover, per-page description/OG/Twitter/canonical passed.`);
