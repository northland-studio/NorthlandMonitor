/* 北域监控 PWA Service Worker：静态资源缓存优先，API 永远走网络 */
const CACHE = 'northland-monitor-v2';
const SHELL = ['/', '/manifest.webmanifest', '/logo.png', '/logo-white-bg.png'];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => undefined));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;
    // API 与安装脚本：不缓存
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/install/')) return;

    event.respondWith(
        caches.match(req).then((hit) => {
            const fetchAndUpdate = fetch(req)
                .then((res) => {
                    if (res && res.ok && res.type === 'basic') {
                        const copy = res.clone();
                        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
                    }
                    return res;
                })
                .catch(() => hit);
            return hit || fetchAndUpdate;
        })
    );
});
