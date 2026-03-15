const CACHE_NAME = 'swg-v2';

// Static assets to pre-cache on install
const PRE_CACHE = [
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// Install: pre-cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRE_CACHE))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all([
        // Delete old cache buckets
        ...keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        // Purge stale .vite/deps chunks from current cache
        caches.open(CACHE_NAME).then((cache) =>
          cache.keys().then((reqs) =>
            Promise.all(
              reqs
                .filter((r) => r.url.includes('.vite/deps/'))
                .map((r) => cache.delete(r))
            )
          )
        ),
      ])
    )
  );
  self.clients.claim();
});

// Fetch: network-first for navigation + API, cache-first for hashed assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Route manifest.json to the correct variant based on the requesting page
  if (url.pathname === '/manifest.json' && event.request.destination === 'manifest') {
    event.respondWith(
      (async () => {
        // Determine which page is requesting the manifest
        const client = await self.clients.get(event.clientId);
        const clientUrl = client ? new URL(client.url).pathname : '/';
        let manifestPath = '/manifest.json';
        if (clientUrl.startsWith('/ai')) manifestPath = '/manifest-ai.json';
        else if (clientUrl.startsWith('/plugin')) manifestPath = '/manifest-plugin.json';
        try {
          return await fetch(manifestPath);
        } catch {
          const cached = await caches.match(manifestPath);
          return cached || await caches.match('/manifest.json');
        }
      })()
    );
    return;
  }

  // Skip non-GET
  if (event.request.method !== 'GET') return;

  // Network-first for navigation (HTML) requests — prevents stale index.html
  if (event.request.mode === 'navigate' ||
      event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Cache the fresh HTML for offline fallback
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request).then((c) => c || caches.match('/')))
    );
    return;
  }

  // Network-first for API calls and supabase
  if (url.pathname.startsWith('/rest/') ||
      url.pathname.startsWith('/auth/') ||
      url.pathname.startsWith('/functions/') ||
      url.hostname.includes('supabase')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Network-first for Vite dep chunks — hashes change between deploys
  if (url.pathname.includes('.vite/deps/') || url.pathname.includes('node_modules/.vite/')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for hashed build assets (/assets/...) — they're immutable
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          const ct = response.headers.get('content-type') || '';
          if (response.ok && (ct.includes('javascript') || ct.includes('css') || ct.includes('wasm'))) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // Network-first for everything else (lib files can change between deploys)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
