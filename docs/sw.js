'use strict';
const APP_VERSION = '0.2.1';
const CACHE_PREFIX = 'workshop-cut-planner:' + self.registration.scope + ':';
const CACHE_NAME = CACHE_PREFIX + '18c6a4d58345f555';
const ASSETS = ["index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"].map(asset => new URL(asset, self.registration.scope).href);
const INDEX = new URL('index.html', self.registration.scope).href;
const ROOT = new URL('./', self.registration.scope).href;
self.addEventListener('install', event => {
    // Activation switches request handling only. Open plans stay in memory and
    // are never automatically reloaded; the client asks before refreshing.
    event.waitUntil((async () => {
        try {
            const cache = await caches.open(CACHE_NAME);
            await cache.addAll(ASSETS.map(url => new Request(url, {cache: 'reload'})));
            await self.skipWaiting();
        } catch (error) {
            await caches.delete(CACHE_NAME);
            throw error;
        }
    })());
});
// Retain compatibility with older clients that explicitly activate an update.
self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
        await self.clients.claim();
        const windows = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
        windows.forEach(client => {
            if (client.url.startsWith(self.registration.scope)) client.postMessage({type: 'APP_VERSION', version: APP_VERSION});
        });
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
                const freshURL = new URL(INDEX);
                freshURL.searchParams.set('__app_version', APP_VERSION);
                freshURL.searchParams.set('__fresh', String(Date.now()));
                response = await fetch(freshURL.href, {cache: 'no-store', signal: controller.signal});
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
