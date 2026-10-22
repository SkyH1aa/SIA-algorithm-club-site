// 给所有公开页面补齐 Open Graph / Twitter / canonical。
//   node tools/add-seo-meta.mjs           补齐（幂等）
//   node tools/add-seo-meta.mjs --check   只校验
//
// 为什么需要：微信、QQ、Telegram 等只读取 HTML 里的 og:* 标签。
// 缺标签时分享出去就是「一条链接 + 空白卡片」。图片必须是位图 PNG
// （1200×630），SVG 在这些客户端里不会被渲染。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const SITE = 'https://skyh1aa.github.io/SIA-algorithm-club-site';
const CHECK = process.argv.includes('--check');

// 不对外分享的页面：后台、聊天、密码重置等。
const EXCLUDED = new Set([
  'admin-hub.html', 'chat-admin.html', 'events-admin.html', 'join-admin.html',
  'mall-admin.html', 'members-admin.html', 'password-reset.html', 'appmonitor.html'
]);

const SHARE_IMAGE = `${SITE}/public/assets/og-cover.png`;

function describe(file) {
  const html = fs.readFileSync(path.join(publicDir, file), 'utf8');
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const title = titleMatch ? titleMatch[1].trim() : '算法社 · Algorithm Club';
  const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]*)"/);
  const description = descMatch
    ? descMatch[1]
    : '算法社官网：算法训练、可视化实验室、AI 五子棋与社团管理系统。';
  return { title, description };
}

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

const files = fs.readdirSync(publicDir).filter(name => name.endsWith('.html') && !EXCLUDED.has(name));
let updated = 0;
const problems = [];

for (const file of files) {
  const full = path.join(publicDir, file);
  let html = fs.readFileSync(full, 'utf8');
  const { title, description } = describe(file);
  const url = `${SITE}/public/${file}`;

  const required = {
    'name="description"': `<meta name="description" content="${escapeAttr(description)}">`,
    'property="og:type"': '<meta property="og:type" content="website">',
    'property="og:site_name"': '<meta property="og:site_name" content="算法社 · Algorithm Club">',
    'property="og:title"': `<meta property="og:title" content="${escapeAttr(title)}">`,
    'property="og:description"': `<meta property="og:description" content="${escapeAttr(description)}">`,
    'property="og:image"': `<meta property="og:image" content="${SHARE_IMAGE}">`,
    'property="og:image:width"': '<meta property="og:image:width" content="1200">',
    'property="og:image:height"': '<meta property="og:image:height" content="630">',
    'property="og:url"': `<meta property="og:url" content="${url}">`,
    'name="twitter:card"': '<meta name="twitter:card" content="summary_large_image">',
    'rel="canonical"': `<link rel="canonical" href="${url}">`
  };

  const missing = [];
  for (const [needle, tag] of Object.entries(required)) {
    const pattern = needle.startsWith('rel=')
      ? /rel="canonical"/.test(html)
      : new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(html);
    if (!pattern) missing.push(tag);
  }

  if (CHECK) {
    if (missing.length) problems.push(`${file}: missing ${missing.length} tag(s)`);
    continue;
  }
  if (!missing.length) continue;

  // 插在 </head> 之前，不改变脚本顺序。
  html = html.replace('</head>', missing.map(tag => `  ${tag}`).join('\n') + '\n</head>');
  fs.writeFileSync(full, html, 'utf8');
  updated += 1;
}

if (CHECK) {
  if (problems.length) {
    console.error(`FAIL ${problems.length} page(s) are missing social meta:`);
    for (const problem of problems) console.error('  -', problem);
    process.exit(1);
  }
  console.log(`PASS all ${files.length} shareable pages carry description + Open Graph + canonical.`);
} else {
  console.log(`Updated ${updated} of ${files.length} pages with social meta.`);
}
