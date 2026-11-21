/* WordLab 离线外壳；仅管理本作品目录的公开资源。 */
const CACHE_PREFIX = `wordlab-${self.registration.scope}-`;
const CACHE = `${CACHE_PREFIX}v2`;
const SHELL = ['./WordLab.html', './manifest.webmanifest', './pwa/icon-192.png', './pwa/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.headers.has('authorization') ||
      url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  // 只缓存随作品提供的外壳；AI、WebDAV、社团页面与第三方请求保持原样。
  if (url.search || !SHELL.some(file => url.href === new URL(file, self.registration.scope).href)) return;
  event.respondWith(
    fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {}));
      }
      return response;
    }).catch(async () => (await (await caches.open(CACHE)).match(request)) || Response.error())
  );
});
