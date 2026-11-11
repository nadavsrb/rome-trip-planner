// Map: the plan's stops per day (numbered, with the route), or everything by layer.
import { DB, get } from '../data.js';
import { store } from '../store.js';
import { esc, icon, fromMin, CATS, FOOD_TYPES } from '../util.js';
import { TRIP, computeDay } from '../planner.js';
import { gmapsDir } from '../geo.js';
import { dayWeather } from '../weather.js';
import { openDetail, dayLabel, emojiOf } from './common.js';
import { myPosition } from './locate.js';

let map = null, layer = null, meMarker = null, container = null;
const f = { mode: 'plan', day: 'all', layers: { place: true, food: false, hotel: true } };

const dayColor = i => getComputedStyle(document.documentElement).getPropertyValue(`--day${i}`).trim() || '#b5482a';
const CAT_COLORS = {
  ancient: '#b5482a', museum: '#8e5ba6', church: '#3e7cb1', piazza: '#c8902f', view: '#d9622b', park: '#5e7a4a',
  neighborhood: '#7a6a5e', jewish: '#2f5fa8', market: '#9a6b2f', experience: '#c2410c', shopping: '#be185d', event: '#0f766e',
};

function ensureMap() {
  if (map) return;
  container = document.createElement('div');
  container.className = 'map-canvas';
  container.setAttribute('dir', 'ltr');
  map = window.L.map(container, { zoomControl: false, attributionControl: true }).setView([TRIP.center.lat, TRIP.center.lng], 14);
  // Leaflet sets position:relative on a detached container; the canvas must fill its parent.
  container.style.position = 'absolute';
  window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap',
  }).addTo(map);
  window.L.control.zoom({ position: 'bottomleft' }).addTo(map);
  layer = window.L.layerGroup().addTo(map);
  map.on('popupopen', ev => {
    const el = ev.popup.getElement();
    el?.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openDetail(b.dataset.open)));
  });
}

function popupHtml(e, extra = '') {
  return `<div class="pop" dir="rtl">
    <b>${emojiOf(e)} ${esc(e.name)}</b>
    ${extra ? `<div class="pop-sub">${extra}</div>` : ''}
    <div class="pop-btns">
      <button class="btn btn-soft btn-xs" data-open="${e.id}">פרטים</button>
      <a class="btn btn-soft btn-xs" href="${gmapsDir(e)}" target="_blank" rel="noopener">ניווט</a>
    </div></div>`;
}

function numberedIcon(n, color, ring = false) {
  return window.L.divIcon({
    className: '',
    html: `<div class="mk ${ring ? 'mk-ring' : ''}" style="--c:${color}"><span>${n}</span></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -12],
  });
}

function drawPlan() {
  const L = window.L;
  const st = store.state;
  const hotel = st.settings.hotelId ? get(st.settings.hotelId) : null;
  const bounds = [];
  TRIP.dates.forEach((date, i) => {
    if (f.day !== 'all' && f.day !== date) return;
    const day = st.days.find(d => d.date === date);
    const c = computeDay(day, st, dayWeather(date));
    const color = dayColor(i);
    const pts = [];
    if (hotel && i > 0 && i < 5) pts.push([hotel.lat, hotel.lng]);
    let n = 0;
    c.items.forEach(ci => {
      if (!ci.loc || !ci.e) return;
      n++;
      pts.push([ci.loc.lat, ci.loc.lng]);
      bounds.push([ci.loc.lat, ci.loc.lng]);
      L.marker([ci.loc.lat, ci.loc.lng], { icon: numberedIcon(n, color, ci.t === 'food') })
        .bindPopup(popupHtml(ci.e, `${dayLabel(date)} · ${fromMin(ci.start)}`))
        .addTo(layer);
    });
    if (hotel && i > 0 && i < 5 && pts.length > 1) pts.push([hotel.lat, hotel.lng]);
    if (pts.length > 1) L.polyline(pts, { color, weight: 3, opacity: 0.75, dashArray: f.day === 'all' ? '6 6' : null }).addTo(layer);
  });
  if (hotel) {
    L.marker([hotel.lat, hotel.lng], { icon: numberedIcon('🏨', '#1f2937') }).bindPopup(popupHtml(hotel, 'המלון שלכם')).addTo(layer);
    bounds.push([hotel.lat, hotel.lng]);
  }
  return bounds;
}

function drawAll() {
  const L = window.L;
  const bounds = [];
  const add = (e, color, r = 7) => {
    if (e.lat == null) return;
    L.circleMarker([e.lat, e.lng], { radius: r, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: 0.95 })
      .bindPopup(popupHtml(e, e.kind === 'food' ? esc(FOOD_TYPES[e.type]?.he || '') : esc(CATS[e.cat]?.he || '')))
      .addTo(layer);
    bounds.push([e.lat, e.lng]);
  };
  if (f.layers.place) DB.places.forEach(e => add(e, CAT_COLORS[e.cat] || '#7a6a5e'));
  if (f.layers.food) DB.food.forEach(e => add(e, e.kosher ? '#2f5fa8' : '#5e7a4a', 6));
  if (f.layers.hotel) DB.hotels.forEach(e => add(e, '#1f2937', 6));
  return bounds;
}

function redraw(fit = true) {
  layer.clearLayers();
  const bounds = f.mode === 'plan' ? drawPlan() : drawAll();
  if (meMarker) meMarker.addTo(layer);
  if (fit && bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
}

export function renderMap(root) {
  if (!window.L) {
    root.innerHTML = '<div class="empty">המפה נטענת… אם אין אינטרנט, היא תעבוד רק באזורים שכבר נצפו.</div>';
    setTimeout(() => { if (location.hash.startsWith('#/map')) renderMap(root); }, 800);
    return;
  }
  ensureMap();
  root.innerHTML = `
    <div class="map-view">
      <div class="map-controls">
        <div class="seg seg-sm">
          <button class="${f.mode === 'plan' ? 'on' : ''}" data-mode="plan">הלו״ז שלנו</button>
          <button class="${f.mode === 'all' ? 'on' : ''}" data-mode="all">כל המקומות</button>
        </div>
        <div class="chips-scroll">${f.mode === 'plan'
          ? [`<button class="chip chip-sm ${f.day === 'all' ? 'on' : ''}" data-day="all">כל הימים</button>`,
            ...TRIP.dates.slice(0, 5).map((d, i) => `<button class="chip chip-sm ${f.day === d ? 'on' : ''}" data-day="${d}" style="--dc:var(--day${i})"><i class="dot"></i>${dayLabel(d)}</button>`)].join('')
          : [['place', 'אטרקציות'], ['food', 'אוכל'], ['hotel', 'מלונות']].map(([k, l]) =>
            `<button class="chip chip-sm ${f.layers[k] ? 'on' : ''}" data-layer="${k}">${l}</button>`).join('')}
        </div>
      </div>
      <button class="fab" data-locate aria-label="המיקום שלי">${icon('locate')}</button>
    </div>`;
  const view = root.querySelector('.map-view');
  view.prepend(container);
  setTimeout(() => { map.invalidateSize(); redraw(); }, 30);

  root.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { f.mode = b.dataset.mode; renderMap(root); }));
  root.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => { f.day = b.dataset.day; renderMap(root); }));
  root.querySelectorAll('[data-layer]').forEach(b => b.addEventListener('click', () => { f.layers[b.dataset.layer] = !f.layers[b.dataset.layer]; renderMap(root); }));
  root.querySelector('[data-locate]').addEventListener('click', async () => {
    const p = await myPosition();
    if (!p) return;
    meMarker = window.L.circleMarker([p.lat, p.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 });
    redraw(false);
    map.setView([p.lat, p.lng], 16);
  });
}

export function focusMapDay(date) { f.mode = 'plan'; f.day = date; }
