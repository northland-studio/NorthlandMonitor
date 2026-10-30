/* 北域监控 PWA Service Worker
 * 策略：
 *  - 页面导航（HTML）：网络优先，失败回退缓存（保证更新立即生效）
 *  - 静态资源（JS/CSS/图片）：缓存优先 + 后台更新
 *  - API / 安装脚本：不缓存
 */
const CACHE = 'northland-monitor-v3';
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
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/install/')) return;

    // 页面导航：网络优先
    if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE).then((c) => c.put('/', copy)).catch(() => undefined);
                    return res;
                })
                .catch(() => caches.match('/'))
        );
        return;
    }

    // 静态资源：缓存优先 + 后台刷新
    event.respondWith(
        caches.match(req).then((hit) => {
            const network = fetch(req)
                .then((res) => {
                    if (res && res.ok && res.type === 'basic') {
                        const copy = res.clone();
                        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
                    }
                    return res;
                })
                .catch(() => hit);
            return hit || network;
        })
    );
});
