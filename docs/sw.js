'use strict';
const CACHE_PREFIX = 'workshop-cut-planner:' + self.registration.scope + ':';
const CACHE_NAME = CACHE_PREFIX + 'f06752385496c814';
const ASSETS = ["index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"].map(asset => new URL(asset, self.registration.scope).href);
const INDEX = new URL('index.html', self.registration.scope).href;
const ROOT = new URL('./', self.registration.scope).href;
self.addEventListener('install', event => {
    // Do not skip waiting: an update must not replace an in-progress cutting plan.
    event.waitUntil((async () => {
        try {
            const cache = await caches.open(CACHE_NAME);
            await cache.addAll(ASSETS.map(url => new Request(url, {cache: 'reload'})));
        } catch (error) {
            await caches.delete(CACHE_NAME);
            throw error;
        }
    })());
});
// Only activate immediately after a user's explicit Refresh app confirmation.
self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;
    url.search = '';
    url.hash = '';
    const target = url.href;
    const appNavigation = event.request.mode === 'navigate' && (target === ROOT || target === INDEX);
    if (!appNavigation && !ASSETS.includes(target)) return;
    // Navigations prefer the published HTML, bypassing the browser HTTP cache.
    // The parser and app code are embedded, so a fresh page is self-contained
    // even if a previous service worker is still controlling this window.
    if (appNavigation) {
        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            let response;
            try {
                response = await fetch(INDEX, {cache: 'no-store', signal: controller.signal});
                if (response.ok && (response.headers.get('content-type') || '').includes('text/html')) {
                    // Cache writes must not prevent a successful online page load.
                    event.waitUntil(cache.put(INDEX, response.clone()).catch(() => {}));
                    return response;
                }
            } catch (error) {
                // Offline, timeout, or network error: use the last working app.
            } finally {
                clearTimeout(timeout);
            }
            return (await cache.match(INDEX)) || response || Response.error();
        })());
        return;
    }
    // Only static app assets use cache-first; never cache models or project data.
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(target)) || fetch(event.request);
    })());
});
