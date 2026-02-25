const CACHE_NAME = 'kaziconnect-v2';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/src/css/style.css',
    '/src/js/db.js',
    '/src/js/main.js',
    'https://unpkg.com/lucide@latest',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@500;700&display=swap'
];

/**
 * Service Worker for KaziConnect.
 * Handles offline caching and background sync.
 */

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Caching static assets');
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Fetch Strategy
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    const url = new URL(event.request.url);

    // Network-First for API requests
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(event.request)
                .then((networkResponse) => {
                    const clone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                    return networkResponse;
                })
                .catch(() => caches.match(event.request))
        );
        return;
    }

    // Stale-While-Revalidate for Static Assets
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            const fetchPromise = fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const clone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                }
                return networkResponse;
            }).catch(() => cachedResponse);

            return cachedResponse || fetchPromise;
        })
    );
});

// Background Sync
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-applications') {
        console.log('[SW] Background sync triggered for applications');
        event.waitUntil(syncApplications());
    }
});

// Message listener for manual sync or other commands
self.addEventListener('message', (event) => {
    if (event.data.action === 'sync') {
        event.waitUntil(syncApplications());
    }
});

async function syncApplications() {
    // We need db.js to be available in the SW scope. 
    // Since we're using Vanilla JS, we'll import it or reimplement the minimal sync logic.
    // However, IndexedDB is available in SW global scope.

    // Minimal implementation for SW (reusing logic from main.js conceptually)
    console.log('[SW] Syncing pending applications in background...');

    // In a real app, we'd importScripts('src/js/db.js') but paths might be tricky.
    // For the hackathon, we'll demonstrate the structure.

    // Sending a message back to clients to update UI if they are open
    const allClients = await clients.matchAll();
    allClients.forEach(client => {
        client.postMessage({ type: 'SYNC_STARTED' });
    });
}
