// Map: our stops per day (an icon for the kind of place, a ring in the day's color, the
// day's route), or every place by layer. Rings: the day it's planned for; gray = not scheduled.
import { DB, get } from '../data.js';
import { store, update } from '../store.js';
import { esc, icon, fromMin, CATS, FOOD_TYPES, bidi } from '../util.js';
import { TRIP, computeDay } from '../planner.js';
import { gmapsDir } from '../geo.js';
import { dayWeather } from '../weather.js';
import { openDetail, dayLabel, emojiOf } from './common.js';
import { myPosition } from './locate.js';
import { toast } from '../ui.js';

let map = null, layer = null, meMarker = null, container = null;
const f = { mode: 'plan', day: 'all', layers: { ours: true, place: false, food: false }, legend: false };

const dayColor = i => getComputedStyle(document.documentElement).getPropertyValue(`--day${i}`).trim() || '#b5482a';
const GRAY = '#8a8f98';
const MAP_DAYS = TRIP.dates.slice(0, 5); // the flight day has no stops in Rome

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
    el?.querySelectorAll('[data-choose]').forEach(b => b.addEventListener('click', () => {
      const [date, u, id] = b.dataset.choose.split('|');
      update(s => {
        const it = s.days.find(d => d.date === date)?.items.find(x => x.u === u);
        if (it) it.id = id;
      }, { silent: true });
      toast(`נבחר: ${get(id)?.name || ''}`);
      map.closePopup();
      redraw(false);
    }));
  });
}

// A round badge with the place's icon; the ring shows the day.
function poiIcon(emoji, color, { n = null, small = false, dashed = false, faded = false, done = false } = {}) {
  const size = small ? 28 : 36;
  return window.L.divIcon({
    className: '',
    html: `<div class="poi ${small ? 'poi-sm' : ''} ${dashed ? 'poi-dashed' : ''} ${faded ? 'poi-faded' : ''} ${done ? 'poi-done' : ''}" style="--c:${color}"><span>${emoji}</span>${n != null ? `<b>${n}</b>` : ''}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 + 2],
  });
}

function popupHtml(e, extra = '', more = '') {
  return `<div class="pop" dir="rtl">
    <b>${emojiOf(e)} ${esc(e.name)}</b>
    ${extra ? `<div class="pop-sub">${extra}</div>` : ''}
    <div class="pop-btns">
      ${e.kind !== 'hotel' ? `<button class="btn btn-soft btn-xs" data-open="${e.id}">פרטים</button>` : ''}
      <a class="btn btn-soft btn-xs" href="${gmapsDir(e)}" target="_blank" rel="noopener">ניווט</a>
      ${more}
    </div></div>`;
}

const hotelOf = st => (st.settings.hotelId ? get(st.settings.hotelId) : null);

function addHotel(bounds) {
  const hotel = hotelOf(store.state);
  if (!hotel) return;
  window.L.marker([hotel.lat, hotel.lng], { icon: poiIcon('🏨', '#1f2937'), zIndexOffset: 500 })
    .bindPopup(popupHtml(hotel, `המלון שלנו · ${esc(hotel.address || '')}`)).addTo(layer);
  bounds.push([hotel.lat, hotel.lng]);
}

function drawPlan() {
  const L = window.L;
  const st = store.state;
  const hotel = hotelOf(st);
  const bounds = [];
  const single = f.day !== 'all';
  MAP_DAYS.forEach((date, i) => {
    if (single && f.day !== date) return;
    const day = st.days.find(d => d.date === date);
    if (!day) return;
    const c = computeDay(day, st, dayWeather(date));
    const color = dayColor(i);
    const pts = [];
    if (hotel && i > 0) pts.push([hotel.lat, hotel.lng]);
    let n = 0;
    c.items.forEach(ci => {
      if (ci.t === 'fixed' && ci.kind === 'hotel' && hotel) { pts.push([hotel.lat, hotel.lng]); return; }
      if (!ci.loc || !ci.e || ci.e.kind === 'hotel') return;
      n++;
      pts.push([ci.loc.lat, ci.loc.lng]);
      bounds.push([ci.loc.lat, ci.loc.lng]);
      const name = ci.title || ci.e.name;
      const extra = `${dayLabel(date)} · ${fromMin(ci.start)}${ci.note ? `<br>${bidi(ci.note)}` : ''}${ci.alts?.length > 1 ? `<br>אופציות: ${ci.alts.map(a => esc(get(a)?.name || '')).join(' / ')}` : ''}`;
      L.marker([ci.loc.lat, ci.loc.lng], { icon: poiIcon(emojiOf(ci.e), color, { n: single ? n : null, done: ci.done }), zIndexOffset: 100 })
        .bindPopup(popupHtml({ ...ci.e, name }, extra))
        .addTo(layer);
      // The other option for the same slot, faded, with a button to switch to it.
      if (single && ci.alts?.length > 1) {
        ci.alts.filter(a => a !== ci.id).forEach(a => {
          const ae = get(a);
          if (!ae || ae.lat == null) return;
          bounds.push([ae.lat, ae.lng]);
          L.marker([ae.lat, ae.lng], { icon: poiIcon(emojiOf(ae), color, { small: true, dashed: true, faded: true }) })
            .bindPopup(popupHtml(ae, `אופציה נוספת ל-${fromMin(ci.start)} (במקום ${esc(ci.e.name)})`,
              `<button class="btn btn-primary btn-xs" data-choose="${date}|${ci.u}|${esc(a)}">לבחור בזה</button>`))
            .addTo(layer);
        });
      }
    });
    if (hotel && pts.length > 1 && i < 5) pts.push([hotel.lat, hotel.lng]);
    if (pts.length > 1) L.polyline(pts, { color, weight: single ? 4 : 3, opacity: 0.8, dashArray: single ? null : '6 7' }).addTo(layer);
  });
  addHotel(bounds);
  return bounds;
}

// Which day each place is planned for (the chosen option or an alternative).
function plannedDay(st) {
  const m = new Map();
  st.days.forEach(d => {
    const i = TRIP.dates.indexOf(d.date);
    d.items.forEach(it => [it.id, ...(it.alts || [])].forEach(id => { if (id && !m.has(id)) m.set(id, i); }));
  });
  return m;
}

function drawAll() {
  const L = window.L;
  const st = store.state;
  const planned = plannedDay(st);
  const bounds = [];
  const add = e => {
    if (e.lat == null) return;
    const di = planned.get(e.id);
    const color = di != null ? dayColor(di) : GRAY;
    const sub = [di != null ? `בלו״ז: ${dayLabel(TRIP.dates[di])}` : e.ours ? 'ברשימה שלנו, עוד לא שובץ' : '',
      e.kind === 'food' ? esc(FOOD_TYPES[e.type]?.he || '') : esc(CATS[e.cat]?.he || '')].filter(Boolean).join(' · ');
    L.marker([e.lat, e.lng], { icon: poiIcon(emojiOf(e), color, { small: !e.ours, dashed: di == null }), zIndexOffset: e.ours ? 100 : 0 })
      .bindPopup(popupHtml(e, sub))
      .addTo(layer);
    if (e.ours || !f.layers.ours) bounds.push([e.lat, e.lng]);
  };
  const near = e => e.area !== 'other' || e.ours; // keep far-away suburbs out of the default view
  if (f.layers.ours) [...DB.places, ...DB.food].filter(e => e.ours).forEach(add);
  if (f.layers.place) DB.places.filter(e => !e.ours && near(e)).forEach(add);
  if (f.layers.food) DB.food.filter(e => !e.ours).forEach(add);
  addHotel(bounds);
  return bounds;
}

function redraw(fit = true) {
  layer.clearLayers();
  const bounds = f.mode === 'plan' ? drawPlan() : drawAll();
  if (meMarker) meMarker.addTo(layer);
  if (fit && bounds.length) {
    // The outlet and the mall are far out of town; frame the centre unless they're all there is.
    const inTown = bounds.filter(([la, ln]) => Math.abs(la - TRIP.center.lat) < 0.05 && Math.abs(ln - TRIP.center.lng) < 0.07);
    map.fitBounds(inTown.length ? inTown : bounds, { padding: [40, 40], maxZoom: 16 });
  }
}

const LEGEND_ICONS = [
  ['🍝', 'מסעדה'], ['🍕', 'פיצה'], ['🍣', 'סושי'], ['🥪', 'אוכל רחוב'], ['🍦', 'גלידה'], ['🍰', 'קינוחים'],
  ['🍫', 'שוקולד'], ['☕', 'קפה ומאפייה'], ['🍹', 'בר'], ['🍺', 'בירה'], ['🏛️', 'אתר היסטורי'], ['⛪', 'כנסייה'],
  ['⛲', 'כיכר ומזרקה'], ['🌅', 'תצפית'], ['🌳', 'פארק'], ['🚣', 'סירות'], ['🧺', 'שוק'], ['🛍️', 'שופינג'],
  ['🕶️', 'משקפי שמש'], ['👩‍🍳', 'סדנה'], ['🕍', 'בית כנסת'], ['🔑', 'חור המנעול'], ['🏨', 'המלון'],
];

function legendHtml() {
  return `<div class="map-legend card">
    <div class="legend-row">${MAP_DAYS.map((d, i) => `<span class="legend-day"><i style="--c:var(--day${i})"></i>${dayLabel(d)}</span>`).join('')}
      <span class="legend-day"><i class="dashed" style="--c:${GRAY}"></i>עוד לא שובץ</span></div>
    <div class="legend-icons">${LEGEND_ICONS.map(([e, l]) => `<span>${e} ${l}</span>`).join('')}</div>
    <small class="muted">המסגרת בצבע היום שבו מבקרים, והמספר הוא הסדר באותו יום.</small>
  </div>`;
}

export function renderMap(root) {
  if (!window.L) {
    root.innerHTML = '<div class="empty">המפה נטענת… בלי אינטרנט היא עובדת רק באזורים שכבר נצפו.</div>';
    setTimeout(() => { if (location.hash.startsWith('#/map')) renderMap(root); }, 800);
    return;
  }
  ensureMap();
  root.innerHTML = `
    <div class="map-view">
      <div class="map-controls">
        <div class="map-top">
          <div class="seg seg-sm">
            <button class="${f.mode === 'plan' ? 'on' : ''}" data-mode="plan">הלו״ז שלנו</button>
            <button class="${f.mode === 'all' ? 'on' : ''}" data-mode="all">כל המקומות</button>
          </div>
          <button class="chip chip-sm legend-btn ${f.legend ? 'on' : ''}" data-legend aria-expanded="${f.legend}">מקרא</button>
        </div>
        <div class="chips-scroll">${f.mode === 'plan'
          ? [`<button class="chip chip-sm ${f.day === 'all' ? 'on' : ''}" data-day="all">כל הימים</button>`,
            ...MAP_DAYS.map((d, i) => `<button class="chip chip-sm ${f.day === d ? 'on' : ''}" data-day="${d}" style="--dc:var(--day${i})"><i class="dot"></i>${dayLabel(d)}</button>`)].join('')
          : [['ours', '📍 המקומות שלנו'], ['place', 'עוד אטרקציות'], ['food', 'עוד אוכל']].map(([k, l]) =>
            `<button class="chip chip-sm ${f.layers[k] ? 'on' : ''}" data-layer="${k}">${l}</button>`).join('')}
        </div>
        ${f.legend ? legendHtml() : ''}
      </div>
      <button class="fab" data-locate aria-label="המיקום שלי">${icon('locate')}</button>
    </div>`;
  const view = root.querySelector('.map-view');
  view.prepend(container);
  setTimeout(() => { map.invalidateSize(); redraw(); }, 30);

  root.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { f.mode = b.dataset.mode; renderMap(root); }));
  root.querySelectorAll('[data-day]').forEach(b => b.addEventListener('click', () => { f.day = b.dataset.day; renderMap(root); }));
  root.querySelectorAll('[data-layer]').forEach(b => b.addEventListener('click', () => { f.layers[b.dataset.layer] = !f.layers[b.dataset.layer]; renderMap(root); }));
  root.querySelector('[data-legend]').addEventListener('click', () => { f.legend = !f.legend; renderMap(root); });
  root.querySelector('[data-locate]').addEventListener('click', async () => {
    const p = await myPosition();
    if (!p) return;
    meMarker = window.L.circleMarker([p.lat, p.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 });
    redraw(false);
    map.setView([p.lat, p.lng], 16);
  });
}

export function focusMapDay(date) { f.mode = 'plan'; f.day = MAP_DAYS.includes(date) ? date : 'all'; }
