// Explore: attractions, experiences, shopping, events and day trips, with filters.
import { DB, get, areaName } from '../data.js';
import { store } from '../store.js';
import { esc, bidi, icon, CATS, weekdayOf, fmtDur, fmtKm, euro } from '../util.js';
import { PLANNABLE_DAYS, closedOn } from '../planner.js';
import { distKm } from '../geo.js';
import { tile, placeBadges, isFav, toggleFav, openDetail, dayLabel, emptyState } from './common.js';
import { myPosition } from './locate.js';

const f = { cat: 'all', q: '', rain: false, free: false, book: false, fav: false, day: '', area: '', sort: 'rec' };
let pos = null;

const items = () => [...DB.places, ...DB.daytrips];

function catChips(list) {
  const counts = {};
  list.forEach(e => { counts[e.cat] = (counts[e.cat] || 0) + 1; });
  const order = Object.keys(CATS).filter(k => counts[k]);
  return [`<button class="chip ${f.cat === 'all' ? 'on' : ''}" data-cat="all">הכול <small>${list.length}</small></button>`,
    ...order.map(k => `<button class="chip ${f.cat === k ? 'on' : ''}" data-cat="${k}">${CATS[k].emoji} ${CATS[k].he} <small>${counts[k]}</small></button>`)].join('');
}

function cardHtml(e, ref) {
  const sub = [areaName(e.area)];
  if (e.kind === 'daytrip') {
    if (e.travelMin) sub.push(`${fmtDur(e.travelMin)} נסיעה לכל כיוון`);
    if (e.costEur) sub.push(`כ-${euro(e.costEur)} לאדם`);
  } else {
    if (e.dur) sub.push(`⏱ ${fmtDur(e.dur)}`);
    if (e.price) sub.push(bidi(e.price));
  }
  const km = ref ? distKm(ref, e) : null;
  if (km != null && e.kind !== 'daytrip') sub.push(`📍 ${fmtKm(km)}`);
  return `<article class="pcard" data-open="${e.id}">
    ${tile(e)}
    <div class="pcard-main">
      <div class="pcard-title"><b>${esc(e.name)}</b>${e.orig ? `<span class="orig" dir="ltr">${esc(e.orig)}</span>` : ''}</div>
      <div class="pcard-sub">${sub.filter(Boolean).join(' · ')}</div>
      <div class="badges">${e.kind === 'place' ? placeBadges(e) : ''}${e.dates ? `<span class="badge badge-sky">${esc(e.dates)}</span>` : ''}</div>
      ${e.desc ? `<p class="pcard-desc">${esc(e.desc)}</p>` : ''}
    </div>
    <div class="pcard-side">
      <button class="icon-btn fav ${isFav(e.id) ? 'on' : ''}" data-fav="${e.id}" aria-label="מועדף">${icon('heart')}</button>
      <button class="icon-btn" data-add="${e.id}" aria-label="הוספה ללו״ז">${icon('plus')}</button>
    </div>
  </article>`;
}

function refPoint() {
  if (f.sort === 'near' && pos) return pos;
  const h = store.state.settings.hotelId ? get(store.state.settings.hotelId) : null;
  if (f.sort === 'hotel' && h) return h;
  return null;
}

function filtered() {
  const q = f.q.trim().toLowerCase();
  const wd = f.day ? weekdayOf(f.day) : null;
  let list = items().filter(e => {
    if (f.cat !== 'all' && e.cat !== f.cat) return false;
    if (q && !`${e.name} ${e.orig || ''} ${e.desc || ''} ${e.tips || ''}`.toLowerCase().includes(q)) return false;
    if (f.rain && !e.indoor) return false;
    if (f.free && !(e.priceEur === 0 || (e.tags || []).includes('free'))) return false;
    if (f.book && e.booking !== 'required') return false;
    if (f.fav && !isFav(e.id)) return false;
    if (wd != null && closedOn(e, wd)) return false;
    if (wd != null && e.days && !e.days.includes(f.day)) return false;
    if (f.area && e.area !== f.area) return false;
    return true;
  });
  const ref = refPoint();
  if (ref) list = list.sort((a, b) => (distKm(ref, a) ?? 99) - (distKm(ref, b) ?? 99));
  else if (f.sort === 'dur') list = list.sort((a, b) => (a.dur || 999) - (b.dur || 999));
  else list = list.sort((a, b) => (a.tier || 3) - (b.tier || 3));
  return { list, ref };
}

export function renderExplore(root) {
  const all = items();
  const areas = [...new Set(all.map(e => e.area).filter(Boolean))];
  root.innerHTML = `
    <div class="search"><span>${icon('search')}</span><input type="search" placeholder="חיפוש אטרקציה, מוזיאון, שכונה…" value="${esc(f.q)}" data-q></div>
    <div class="chips-scroll" data-cats>${catChips(all)}</div>
    <div class="filters">
      <button class="chip chip-sm ${f.rain ? 'on' : ''}" data-flag="rain">☔ מתאים לגשם</button>
      <button class="chip chip-sm ${f.free ? 'on' : ''}" data-flag="free">חינם</button>
      <button class="chip chip-sm ${f.book ? 'on' : ''}" data-flag="book">🎟️ צריך הזמנה</button>
      <button class="chip chip-sm ${f.fav ? 'on' : ''}" data-flag="fav">♥ מועדפים</button>
      <select class="mini-select" data-day aria-label="פתוח ביום">
        <option value="">פתוח בכל יום</option>
        ${PLANNABLE_DAYS.map(d => `<option value="${d}" ${f.day === d ? 'selected' : ''}>פתוח ב${dayLabel(d)}</option>`).join('')}
      </select>
      <select class="mini-select" data-area aria-label="אזור">
        <option value="">כל האזורים</option>
        ${areas.map(a => `<option value="${a}" ${f.area === a ? 'selected' : ''}>${esc(areaName(a) || a)}</option>`).join('')}
      </select>
      <select class="mini-select" data-sort aria-label="מיון">
        <option value="rec" ${f.sort === 'rec' ? 'selected' : ''}>מיון: מומלץ</option>
        <option value="near" ${f.sort === 'near' ? 'selected' : ''}>הכי קרוב אליי</option>
        <option value="hotel" ${f.sort === 'hotel' ? 'selected' : ''}>הכי קרוב למלון</option>
        <option value="dur" ${f.sort === 'dur' ? 'selected' : ''}>הכי קצר</option>
      </select>
    </div>
    <div class="results" data-results></div>`;

  const results = root.querySelector('[data-results]');
  const draw = () => {
    const { list, ref } = filtered();
    results.innerHTML = list.length
      ? `<div class="count muted small">${list.length} תוצאות</div>${list.map(e => cardHtml(e, ref)).join('')}`
      : emptyState('אין תוצאות לסינון הזה.');
    results.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', ev => {
      if (ev.target.closest('button')) return;
      openDetail(el.dataset.open);
    }));
    results.querySelectorAll('[data-fav]').forEach(b => b.addEventListener('click', () => {
      toggleFav(b.dataset.fav);
      b.classList.toggle('on', isFav(b.dataset.fav));
    }));
    results.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => openDetail(b.dataset.add)));
  };

  root.querySelector('[data-q]').addEventListener('input', ev => { f.q = ev.target.value; draw(); });
  root.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => {
    f.cat = b.dataset.cat;
    root.querySelectorAll('[data-cat]').forEach(x => x.classList.toggle('on', x === b));
    draw();
  }));
  root.querySelectorAll('[data-flag]').forEach(b => b.addEventListener('click', () => {
    f[b.dataset.flag] = !f[b.dataset.flag];
    b.classList.toggle('on', f[b.dataset.flag]);
    draw();
  }));
  root.querySelector('[data-day]').addEventListener('change', ev => { f.day = ev.target.value; draw(); });
  root.querySelector('[data-area]').addEventListener('change', ev => { f.area = ev.target.value; draw(); });
  root.querySelector('[data-sort]').addEventListener('change', async ev => {
    f.sort = ev.target.value;
    if (f.sort === 'near' && !pos) pos = await myPosition();
    draw();
  });
  draw();
}

export const exploreFilters = f;
