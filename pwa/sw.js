'use strict';
const CACHE_PREFIX = 'workshop-cut-planner:' + self.registration.scope + ':';
const CACHE_NAME = CACHE_PREFIX + '__BUILD_VERSION__';
const ASSETS = __PRECACHE_ASSETS__.map(asset => new URL(asset, self.registration.scope).href);
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
    // Cache only packaged app files, never imported models, projects, or other sites.
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(appNavigation ? INDEX : target)) || fetch(event.request);
    })());
});
