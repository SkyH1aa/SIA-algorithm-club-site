// Offline: node tools/test-seo.mjs
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
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

// 微信/QQ 的链接卡片缩略图是**中心正方形裁切**。所有文字与 logo 必须落在
// 中心 630x630 内，否则分享出去只看到被裁掉一半的画面。
// 这里用像素抽样验证：安全区外只允许是背景/装饰，不应有高对比度的文字像素。
{
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  // 解码为像素需要 zlib；用 Node 内置能力读出 IDAT 并展开。
  const zlib = await import('node:zlib');
  let offset = 8;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') idat.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 3; // PNG 由 build-og-cover.py 以 RGB 写出
  const stride = width * bpp + 1;
  const pixels = Buffer.alloc(width * height * bpp);
  let prev = Buffer.alloc(width * bpp);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * stride];
    const line = raw.subarray(y * stride + 1, y * stride + 1 + width * bpp);
    const out = Buffer.alloc(width * bpp);
    for (let i = 0; i < line.length; i += 1) {
      const left = i >= bpp ? out[i - bpp] : 0;
      const up = prev[i];
      const upLeft = i >= bpp ? prev[i - bpp] : 0;
      let value = line[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        value += (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : upLeft);
      }
      out[i] = value & 0xff;
    }
    out.copy(pixels, y * width * bpp);
    prev = out;
  }
  const safeX0 = Math.floor((width - height) / 2);
  const safeX1 = safeX0 + height;
  const bright = (x, y) => {
    const i = (y * width + x) * bpp;
    return (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
  };
  let outsideBright = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (x >= safeX0 && x < safeX1) continue;
      if (bright(x, y) > 120) outsideBright += 1;
    }
  }
  assert.equal(outsideBright, 0,
    `share image has ${outsideBright} bright pixels outside the centre square; WeChat crops to that square`);
}

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
// Every shareable page needs the tags, not just the pages added this round.
// WeChat/QQ show a blank card when og:image is missing.
const shareable = (await readdir(path.join(root, 'public')))
  .filter(name => name.endsWith('.html'))
  .filter(name => !['admin-hub.html', 'chat-admin.html', 'events-admin.html', 'join-admin.html',
    'mall-admin.html', 'members-admin.html', 'password-reset.html', 'appmonitor.html'].includes(name))
  .map(name => [`public/${name}`, `/public/${name}`]);
for (const [file, expected] of [...shareable, ['index.html', '/index.html']]) {
  const html = await read(file);
  assert.match(html, /<meta name="description" content="[^"]{20,}"/, `${file} has a description`);
  assert.match(html, /property="og:title"/, `${file} has og:title`);
  assert.match(html, /property="og:description"/, `${file} has og:description`);
  assert.match(html, /property="og:image" content="[^"]*og-cover\.png"/, `${file} shares the cover image`);
  assert.match(html, /property="og:url" content="[^"]+"/, `${file} has og:url`);
  assert.match(html, /name="twitter:card" content="summary_large_image"/, `${file} has a Twitter card`);
  // 微信/QQ 抓取器不总读 og:image，这几种写法是提高取图率的实际手段。
  assert.match(html, /name="twitter:image" content="[^"]*og-cover\.png"/, `${file} has twitter:image`);
  assert.match(html, /itemprop="image" content="[^"]*og-cover\.png"/, `${file} has itemprop=image`);
  assert.match(html, /rel="image_src" href="[^"]*og-cover\.png"/, `${file} has link rel=image_src`);
  assert.match(html, new RegExp(`rel="canonical" href="${SITE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
    `${file} canonical points at the project page`);
}

console.log(`SEO: ${locs.length}-URL sitemap, robots exclusions, 1200×630 PNG cover, per-page description/OG/Twitter/canonical passed.`);
