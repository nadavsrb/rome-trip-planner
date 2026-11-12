// Offline support. Our own files (pages, code, data) come fresh from the network first,
// with a short timeout, so a new version shows up the next time the app opens without any
// manual refresh; the cache is only the fallback when there's no (or a very slow) connection.
// Libraries from CDNs have fixed versions and are cached for good; map tiles are cached as you browse.
const VERSION = 'rome26-v4';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/util.js', './js/geo.js', './js/store.js', './js/data.js', './js/planner.js',
  './js/weather.js', './js/ui.js', './js/sync.js',
  './js/views/common.js', './js/views/plan.js', './js/views/explore.js', './js/views/food.js',
  './js/views/hotels.js', './js/views/map.js', './js/views/info.js', './js/views/settings.js', './js/views/locate.js',
  './data/places.json', './data/food.json', './data/hotels.json', './data/daytrips.json', './data/plan.json', './data/info.json',
  './data/ours.json', './data/schedule.json', './data/images.json',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];
const CDN = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js',
];
const TILES = 'rome26-tiles';
const MAX_TILES = 900;
const NET_TIMEOUT = 3000; // after this, show the saved copy and let the network finish in the background

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // Straight from the network: the browser's HTTP cache may still hold the previous files.
    await cache.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    await Promise.all(CDN.map(u => cache.add(new Request(u, { mode: 'cors' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const old = keys.filter(k => k !== VERSION && k !== TILES);
    await Promise.all(old.map(k => caches.delete(k)));
    await self.clients.claim();
    // This is an update: reload every open window, so nobody keeps looking at the old
    // version until the app is fully closed (pages of older versions can't do it themselves).
    if (old.length) {
      const wins = await self.clients.matchAll({ type: 'window' });
      // Not awaited: the reload's requests wait for this worker to finish activating,
      // so waiting for the reload here would deadlock.
      wins.forEach(c => { if (typeof c.navigate === 'function') c.navigate(c.url).catch(() => {}); });
    }
  })());
});

// Our own files: network first (revalidating the browser's HTTP cache), saved copy as fallback.
function fresh(event, url) {
  const net = fetch(url, { cache: 'no-cache' }).then(async res => {
    if (res.ok) {
      const cache = await caches.open(VERSION);
      await cache.put(url, res.clone());
    }
    return res;
  });
  event.waitUntil(net.catch(() => {})); // keep the worker alive until the cache is updated
  return (async () => {
    try {
      const res = await Promise.race([net, new Promise(r => setTimeout(r, NET_TIMEOUT, null))]);
      if (res) return res;
    } catch { /* offline: use the saved copy */ }
    const cache = await caches.open(VERSION);
    const hit = await cache.match(url, { ignoreSearch: true });
    return hit || net.catch(() => Response.error());
  })();
}

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) || Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

async function tile(req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(req, res.clone());
      const keys = await cache.keys();
      if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map(k => cache.delete(k)));
    }
    return res;
  } catch {
    return Response.error();
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('tile.openstreetmap.org')) { event.respondWith(tile(req)); return; }
  if (url.hostname === 'api.open-meteo.com') { event.respondWith(networkFirst(req)); return; }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'
    || url.hostname === 'unpkg.com' || url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(fresh(event, new URL('./index.html', self.registration.scope).href));
    return;
  }
  event.respondWith(fresh(event, url.origin + url.pathname));
});
