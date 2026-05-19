// Service Worker for JJ Apartment RMS
// Strategy:
//   - Static shell (HTML/CSS/JS/icons): cache-first, update in background
//   - Google Apps Script API calls: always network (never cached here)
// Bump CACHE_VER when deploying new code so stale shells are evicted.

const CACHE_VER = 'v1';
const CACHE_NAME = `jjrms-shell-${CACHE_VER}`;

const SHELL = [
  './',
  './index.html',
  './admin.html',
  './tenant.html',
  './api.js',
  './admin.js',
  './tenant.js',
  './style.css',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg',
];

// ── Install: pre-cache the app shell ────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

// ── Activate: delete old cache versions ─────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: route requests ────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept GAS API calls — always go to network
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('googleusercontent.com')) {
    return;
  }

  // Only handle same-origin GET requests
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(networkFirstWithCache(request));
});

async function networkFirstWithCache(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const networkRes = await fetch(request);
    if (networkRes.ok) {
      cache.put(request, networkRes.clone());
    }
    return networkRes;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // If nothing cached and network failed, return a minimal offline page
    if (request.destination === 'document') {
      return new Response(
        '<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:2rem">' +
        '<h2>You\'re offline</h2><p>Please reconnect and reload to use the app.</p></body></html>',
        { headers: { 'Content-Type': 'text/html' } }
      );
    }
    throw new Error('Network error and no cache available');
  }
}
