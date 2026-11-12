// Offline support. App files are precached per version; data files are network-first
// so plan updates show up right away; map tiles are cached as you browse.
const VERSION = 'rome26-v3';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/util.js', './js/geo.js', './js/store.js', './js/data.js', './js/planner.js',
  './js/weather.js', './js/ui.js', './js/sync.js',
  './js/views/common.js', './js/views/plan.js', './js/views/explore.js', './js/views/food.js',
  './js/views/hotels.js', './js/views/map.js', './js/views/info.js', './js/views/settings.js', './js/views/locate.js',
  './data/places.json', './data/food.json', './data/hotels.json', './data/daytrips.json', './data/plan.json', './data/info.json',
  './data/ours.json', './data/schedule.json',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];
const CDN = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js',
];
const TILES = 'rome26-tiles';
const MAX_TILES = 900;

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
    // version until the app is fully closed (pages of the first version can't do it themselves).
    if (old.length) {
      const wins = await self.clients.matchAll({ type: 'window' });
      // Not awaited: the reload's requests wait for this worker to finish activating,
      // so waiting for the reload here would deadlock.
      wins.forEach(c => { if (typeof c.navigate === 'function') c.navigate(c.url).catch(() => {}); });
    }
  })());
});

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

async function cacheFirst(req, cacheName = VERSION) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: cacheName === VERSION });
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
  if (url.pathname.includes('/data/')) { event.respondWith(networkFirst(req)); return; }
  if (req.mode === 'navigate') { event.respondWith(cacheFirst(new Request('./index.html'))); return; }
  event.respondWith(cacheFirst(req));
});
