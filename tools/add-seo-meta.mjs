// 给自己新增页面补全 SEO / 社交分享 meta。
//   node tools/add-seo-meta.mjs
//
// 规则：
// * 只补缺失项，不改已有 title/description。
// * canonical 与 og:url 用 GitHub Pages 项目页地址（SkyH1aa/SIA-algorithm-club-site）。
// * og:image 指向 1200×630 PNG —— 微信/QQ 不支持 SVG 分享图。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://skyh1aa.github.io/SIA-algorithm-club-site';

const PAGES = {
  'public/notifications.html': {
    title: '通知 · 算法社',
    description: '算法社站内通知：公告、活动、报名、积分与留言提醒集中在一处，登录后可查看并标记已读。',
    path: '/public/notifications.html'
  },
  'public/member-profile.html': {
    title: '社员主页 · 算法社',
    description: '算法社社员个人主页：积分、捐赠、五子棋/俄罗斯方块/贪吃蛇战绩与签到记录，展示范围由本人决定。',
    path: '/public/member-profile.html'
  },
  'public/search.html': {
    title: '站内搜索 · 算法社',
    description: '算法社站内搜索：查找社员、公告、活动与积分商城商品，未登录也可使用。',
    path: '/public/search.html'
  },
  'public/donations.html': {
    title: '社团捐赠名单 · 算法社',
    description: '算法社社团捐赠名单：按金额排序，登录可查看，超级管理员可维护记录与收款码。',
    path: '/public/donations.html'
  }
};

const OG_IMAGE = `${SITE}/public/assets/og-cover.png`;

for (const [relative, meta] of Object.entries(PAGES)) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) { console.log('skip missing', relative); continue; }
  let html = fs.readFileSync(file, 'utf8');
  const additions = [];

  if (!/<meta\s+name="description"/i.test(html)) {
    additions.push(`<meta name="description" content="${meta.description}">`);
  }
  if (!/property="og:type"/i.test(html)) additions.push('<meta property="og:type" content="website">');
  if (!/property="og:site_name"/i.test(html)) additions.push('<meta property="og:site_name" content="算法社 · Algorithm Club">');
  if (!/property="og:title"/i.test(html)) additions.push(`<meta property="og:title" content="${meta.title}">`);
  if (!/property="og:description"/i.test(html)) additions.push(`<meta property="og:description" content="${meta.description}">`);
  if (!/property="og:image"/i.test(html)) additions.push(`<meta property="og:image" content="${OG_IMAGE}">`);
  if (!/property="og:image:width"/i.test(html)) additions.push('<meta property="og:image:width" content="1200">');
  if (!/property="og:image:height"/i.test(html)) additions.push('<meta property="og:image:height" content="630">');
  if (!/property="og:url"/i.test(html)) additions.push(`<meta property="og:url" content="${SITE}${meta.path}">`);
  if (!/name="twitter:card"/i.test(html)) additions.push('<meta name="twitter:card" content="summary_large_image">');
  if (!/rel="canonical"/i.test(html)) additions.push(`<link rel="canonical" href="${SITE}${meta.path}">`);

  if (!additions.length) { console.log('already complete', relative); continue; }
  // Insert immediately before </head> so it never disturbs script order.
  html = html.replace('</head>', additions.map(line => `  ${line}`).join('\n') + '\n</head>');
  fs.writeFileSync(file, html, 'utf8');
  console.log(`updated ${relative} (+${additions.length})`);
}
