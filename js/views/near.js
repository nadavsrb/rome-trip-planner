// Around me: good places close to where you are (or the hotel, or the next stop), by walking
// time with our own picks and must-tries first, what's open right now, and a tap to navigate.
import { DB, get, areaName } from '../data.js';
import { store } from '../store.js';
import { esc, icon, fmtKm, fromMin, romeToday, romeNowMin, weekdayOf, priceLevel, FOOD_TYPES, CATS } from '../util.js';
import { TRIP, hoursFor, computeDay } from '../planner.js';
import { leg, gmapsDir } from '../geo.js';
import { hourWeather, wetness, dayWeather } from '../weather.js';
import { myPosition } from './locate.js';
import { tile, openDetail } from './common.js';

const GROUPS = [
  ['all', '✨ הכול'],
  ['eat', '🍝 לאכול'],
  ['sweet', '🍦 גלידה ומתוקים'],
  ['coffee', '☕ קפה ומאפה'],
  ['drinks', '🍹 בר ויין'],
  ['see', '🏛️ לראות'],
  ['shop', '🛍️ קניות'],
];
const FOOD_GROUP = {
  restaurant: 'eat', trattoria: 'eat', pizza: 'eat', sushi: 'eat', street: 'eat', fine: 'eat', market: 'eat', grocery: 'eat',
  gelato: 'sweet', dessert: 'sweet', chocolate: 'sweet',
  coffee: 'coffee', bakery: 'coffee',
  aperitivo: 'drinks', wine: 'drinks',
};
const SEE = new Set(['ancient', 'museum', 'church', 'piazza', 'view', 'park', 'neighborhood', 'jewish', 'market']);
// What to look up in Google Maps around the same spot, for anything beyond our list.
const GMAPS_Q = { all: 'ristoranti', eat: 'ristoranti', sweet: 'gelateria', coffee: 'caffè', drinks: 'cocktail bar', see: 'attrazioni turistiche', shop: 'negozi' };

const GMAPS_LABEL = { all: 'מקומות טובים', eat: 'מסעדות', sweet: 'גלידריות', coffee: 'בתי קפה', drinks: 'ברים', see: 'אטרקציות', shop: 'חנויות' };

const groupOf = e => (e.kind === 'food' ? FOOD_GROUP[e.type] || 'eat' : e.cat === 'shopping' ? 'shop' : SEE.has(e.cat) ? 'see' : null);

const f = { group: 'all', open: true, mins: 20 };
let here = null;       // { lat, lng }
let hereLabel = '';
let hereSrc = '';      // 'me' | 'hotel' | 'next'
let hereAt = 0;
let locating = false;

const hotelOf = () => (store.state.settings.hotelId ? get(store.state.settings.hotelId) : null);

// The next stop on today's plan that has a place, if the trip is on.
function nextStop() {
  const today = romeToday();
  const day = store.state.days?.find(d => d.date === today);
  if (!day) return null;
  const c = computeDay(day, store.state, dayWeather(today));
  const now = romeNowMin();
  return c.items.find(x => !x.done && x.loc && x.e && x.e.kind !== 'hotel' && x.end > now) || null;
}

function openNow(e, wd, now) {
  const r = hoursFor(e, wd);
  if (r === null) return { known: false, open: true, text: 'שעות לא ידועות' };
  if (!r.length) return { known: true, open: false, text: 'סגור היום' };
  for (const [a, b] of r) {
    if (a === 0 && b >= 1439) return { known: true, open: true, text: 'פתוח תמיד' };
    if (now >= a && now < b) {
      const left = b - now;
      return { known: true, open: true, soon: left <= 45, text: left <= 45 ? `נסגר בעוד ${left} דק׳` : `פתוח עד ${fromMin(b)}` };
    }
  }
  const next = r.find(([a]) => a > now);
  return { known: true, open: false, text: next ? `נפתח ב-${fromMin(next[0])}` : 'סגור כבר להיום' };
}

function results() {
  const wd = weekdayOf(romeToday());
  const now = romeNowMin();
  const rain = wetness(hourWeather(romeToday(), Math.floor(now / 60))) >= 2;
  const rows = [];
  for (const e of [...DB.food, ...DB.places]) {
    if (e.lat == null) continue;
    const g = groupOf(e);
    if (!g || (f.group !== 'all' && g !== f.group)) continue;
    if (e.days && !e.days.includes(romeToday())) continue;
    const l = leg(here, e);
    if (!l || l.walk > f.mins) continue;
    const st = openNow(e, wd, now);
    if (f.open && !st.open) continue;
    const covered = e.kind === 'food' ? e.type !== 'street' : e.indoor === true;
    const score = l.walk
      - (e.ours ? 6 : 0) - (e.top ? 4 : 0) - (e.tier === 1 ? 3 : e.tier === 2 ? 1 : 0)
      - (rain && covered ? 5 : 0) + (st.known ? 0 : 3) + (st.soon ? 4 : 0);
    rows.push({ e, l, st, score, g });
  }
  rows.sort((a, b) => a.score - b.score);
  return { rows: rows.slice(0, 60), rain };
}

function cardHtml({ e, l, st }) {
  const type = e.kind === 'food' ? FOOD_TYPES[e.type]?.he : CATS[e.cat]?.he;
  const sub = [type, `🚶 ${l.walk} דק׳ · ${fmtKm(l.km)}`, e.kind === 'food' ? priceLevel(e.price) : (e.priceEur === 0 ? 'חינם' : '')].filter(Boolean).join(' · ');
  const badges = [
    e.ours ? `<span class="badge badge-sky">📍 ${e.wish ? 'ברשימה שלנו' : 'שלנו'}</span>` : '',
    e.top ? '<span class="badge badge-accent">⭐ חובה לטעום</span>' : '',
    e.tier === 1 ? '<span class="badge badge-accent">חובה</span>' : '',
  ].join('');
  const blurb = e.order ? `<b>מה להזמין:</b> ${esc(e.order)}` : esc(e.desc || '');
  return `<article class="pcard ncard" data-open="${esc(e.id)}">
    ${tile(e)}
    <div class="pcard-main">
      <div class="pcard-title"><b>${esc(e.name)}</b></div>
      <div class="pcard-sub">${sub}${areaName(e.area) ? ` · ${esc(areaName(e.area))}` : ''}</div>
      <div class="ncard-open ${!st.known ? 'unk' : st.open ? (st.soon ? 'soon' : 'ok') : 'closed'}">${st.open && st.known ? '🟢' : st.known ? '🔴' : '⚪'} ${esc(st.text)}</div>
      ${badges ? `<div class="badges">${badges}</div>` : ''}
      ${blurb ? `<p class="pcard-desc">${blurb}</p>` : ''}
    </div>
    <div class="pcard-side">
      <a class="btn btn-primary btn-xs" href="${gmapsDir(e, here)}" target="_blank" rel="noopener">${icon('nav')}ניווט</a>
    </div>
  </article>`;
}

async function locate(root, how = 'me') {
  hereSrc = how;
  hereAt = Date.now();
  if (how === 'hotel') {
    const h = hotelOf();
    if (h) { here = { lat: h.lat, lng: h.lng }; hereLabel = `ליד ${h.name}`; }
  } else if (how === 'next') {
    const n = nextStop();
    if (n) { here = n.loc; hereLabel = `ליד ${n.title || n.e.name} (${fromMin(n.start)})`; }
  } else {
    locating = true;
    renderNear(root);
    const p = await myPosition();
    locating = false;
    if (p) {
      here = p;
      hereLabel = p === TRIP.center ? 'מרכז העיר (עוד לא ברומא)' : 'לפי המיקום שלך';
    } else if (!here) {
      const h = hotelOf();
      if (h) { here = { lat: h.lat, lng: h.lng }; hereLabel = `ליד ${h.name} (לא התקבל מיקום)`; }
    }
  }
  if (location.hash.startsWith('#/near')) renderNear(root);
}

export function renderNear(root) {
  // First visit, or back after a few minutes on "my location": look again (people move).
  if (!locating && (!here || (hereSrc === 'me' && Date.now() - hereAt > 3 * 60 * 1000))) { locate(root, 'me'); return; }
  const next = nextStop();
  const top = `
    <section class="card near-head">
      <h2 class="h2 tight">📍 מה טוב סביבי</h2>
      <div class="near-where">${locating ? 'מאתר את המיקום שלכם…' : esc(hereLabel)}</div>
      <div class="chips-scroll near-from">
        <button class="chip chip-sm" data-from="me">${icon('locate')} המיקום שלי</button>
        <button class="chip chip-sm" data-from="hotel">🏨 ליד המלון</button>
        ${next ? `<button class="chip chip-sm" data-from="next">➡️ ליד התחנה הבאה</button>` : ''}
      </div>
    </section>`;
  if (locating || !here) {
    root.innerHTML = `${top}<div class="empty">${locating ? 'רגע, מאתר…' : 'לא התקבל מיקום. אפשר לבחור "ליד המלון".'}</div>`;
    bind(root);
    return;
  }
  const { rows, rain } = results();
  const q = GMAPS_Q[f.group] || 'ristoranti';
  root.innerHTML = `${top}
    ${rain ? '<div class="warn warn-mid near-rain">☔ יורד גשם עכשיו: מקומות מקורים מופיעים קודם</div>' : ''}
    <div class="chips-scroll" data-groups>${GROUPS.map(([g, l]) => `<button class="chip ${f.group === g ? 'on' : ''}" data-g="${g}">${l}</button>`).join('')}</div>
    <div class="filters">
      <button class="chip chip-sm ${f.open ? 'on' : ''}" data-open-now>פתוח עכשיו</button>
      ${[10, 20, 30].map(m => `<button class="chip chip-sm ${f.mins === m ? 'on' : ''}" data-mins="${m}">עד ${m} דק׳ הליכה</button>`).join('')}
    </div>
    <div class="count muted small">${rows.length ? `${rows.length} מקומות, הקרובים והמומלצים קודם` : ''}</div>
    <div class="results">${rows.length ? rows.map(cardHtml).join('') : `<div class="empty">לא מצאנו ברשימה שלנו מקום${f.open ? ' פתוח' : ''} במרחק הזה. אפשר להרחיב את המרחק, או לחפש ב-Google Maps.</div>`}</div>
    <a class="btn btn-soft btn-block near-gmaps" href="https://www.google.com/maps/search/${encodeURIComponent(q)}/@${here.lat},${here.lng},16z" target="_blank" rel="noopener">${icon('search')}עוד ${GMAPS_LABEL[f.group]} סביבי ב-Google Maps</a>`;
  bind(root);
}

function bind(root) {
  root.querySelectorAll('[data-from]').forEach(b => b.addEventListener('click', () => locate(root, b.dataset.from)));
  root.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => { f.group = b.dataset.g; renderNear(root); }));
  root.querySelector('[data-open-now]')?.addEventListener('click', () => { f.open = !f.open; renderNear(root); });
  root.querySelectorAll('[data-mins]').forEach(b => b.addEventListener('click', () => { f.mins = +b.dataset.mins; renderNear(root); }));
  root.querySelectorAll('.ncard[data-open]').forEach(el => el.addEventListener('click', ev => {
    if (ev.target.closest('a,button')) return;
    openDetail(el.dataset.open);
  }));
}

