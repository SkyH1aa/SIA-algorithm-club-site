// 算法社 PWA Service Worker —— 只缓存应用外壳。
//
// 设计约束：
// * Supabase 与 club-drive 的请求永不缓存（否则会看到过期的积分/战绩/通知）。
// * HTML 走 network-first，保证公告与活动不陈旧；离线时回退到缓存的壳。
// * CSS/JS/字体走 cache-first，文件名带内容哈希，天然可长期缓存。
// * 版本号来自 asset-versions.json，构建时写死；改共享资源后重新生成即可。
const VERSION = 'b525095a89';
const SHELL_CACHE = `club-shell-${VERSION}`;
const RUNTIME_CACHE = `club-runtime-${VERSION}`;

const SHELL_ASSETS = [
  './index.html',
  './404.html',
  './public/club-ui.css',
  './public/theme.css',
  './public/theme.js',
  './public/i18n.js',
  './public/i18n-dict.js',
  './public/club-common.js',
  './public/club-shell.js',
  './public/favicon.svg',
  './public/manifest.webmanifest',
  // 品牌字体：字体 CSS 与 Inter 拉丁块离线可用；MiSans 的 56 个分块走
  // 运行时 cache-first，浏览到哪块缓存哪块，不把 4.6MB 全塞进安装包。
  './public/assets/fonts/club-fonts.css',
  './public/assets/fonts/misans/MiSansVF.min.css',
  './public/assets/fonts/inter/inter-latin-wght-normal.woff2'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== SHELL_CACHE && key !== RUNTIME_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// 这些请求绝不能进缓存：认证、数据库、边缘函数、第三方 API。
function isPrivate(url) {
  return /supabase\.co|\/functions\/v1\/|\/auth\/v1\/|\/rest\/v1\//.test(url);
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isPrivate(request.url)) return;

  const acceptsHtml = request.headers.get('accept')?.includes('text/html');
  if (acceptsHtml) {
    // network-first：离线时才用缓存的壳。
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match('./index.html');
        })
    );
    return;
  }

  // 数据文件（公告/成员/项目/更新日志）可被后台改写，必须 network-first：
  // 页面的 cache:'no-store' 只管 HTTP 缓存，拦不住 SW 的 caches.match。
  if (url.pathname.includes('/data/') && (url.pathname.endsWith('.json') || url.pathname.endsWith('changelog-data.js'))) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || Response.error())
    );
    return;
  }

  // 静态资源 cache-first。
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      }).catch(() => cached);
    })
  );
});
