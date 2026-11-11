// Food: kosher first, vegetarian-friendly elsewhere, with type/area/day filters
// and quick guides (Roman-Jewish dishes, vegetarian classics, phrases).
import { DB, get, areaName } from '../data.js';
import { store } from '../store.js';
import { esc, icon, FOOD_TYPES, WD_SHORT, weekdayOf, fmtKm, priceLevel, richText } from '../util.js';
import { PLANNABLE_DAYS, closedOn, dietOk, DIETS } from '../planner.js';
import { distKm } from '../geo.js';
import { openSheet } from '../ui.js';
import { tile, foodBadges, isFav, toggleFav, openDetail, dayLabel, emptyState } from './common.js';
import { myPosition } from './locate.js';

const f = { type: 'all', q: '', kosher: false, veg: false, top: false, fav: false, day: '', area: '', price: 0, sort: 'rec', diet: true };
let pos = null;

const TYPE_ORDER = ['restaurant', 'trattoria', 'pizza', 'street', 'gelato', 'coffee', 'bakery', 'aperitivo', 'wine', 'fine', 'market', 'grocery'];

function typeChips(list) {
  const counts = {};
  list.forEach(x => { counts[x.type] = (counts[x.type] || 0) + 1; });
  const kosherN = list.filter(x => x.kosher).length;
  return [
    `<button class="chip ${f.type === 'all' ? 'on' : ''}" data-type="all">הכול <small>${list.length}</small></button>`,
    `<button class="chip chip-kosher ${f.type === 'kosher' ? 'on' : ''}" data-type="kosher">✡ כשר <small>${kosherN}</small></button>`,
    `<button class="chip ${f.type === 'experience' ? 'on' : ''}" data-type="experience">👩‍🍳 חוויות אוכל</button>`,
    ...TYPE_ORDER.filter(t => counts[t]).map(t => `<button class="chip ${f.type === t ? 'on' : ''}" data-type="${t}">${FOOD_TYPES[t].emoji} ${FOOD_TYPES[t].he} <small>${counts[t]}</small></button>`),
  ].join('');
}

function cardHtml(x, ref) {
  const sub = [areaName(x.area), x.kind === 'food' ? priceLevel(x.price) : (x.price || '')];
  const km = ref ? distKm(ref, x) : null;
  if (km != null) sub.push(`📍 ${fmtKm(km)}`);
  const closed = (x.closed || []).length && x.closed.length < 7 ? `סגור ב${x.closed.map(d => WD_SHORT[d]).join(' ')}` : '';
  if (closed) sub.push(closed);
  if (x.kosher?.shabbat) sub.push('סגור בשבת');
  return `<article class="pcard" data-open="${x.id}">
    ${tile(x)}
    <div class="pcard-main">
      <div class="pcard-title"><b>${esc(x.name)}</b>${x.orig ? `<span class="orig" dir="ltr">${esc(x.orig)}</span>` : ''}</div>
      <div class="pcard-sub">${sub.filter(Boolean).join(' · ')}</div>
      <div class="badges">${x.kind === 'food' ? foodBadges(x) : (x.vegFriendly ? '<span class="badge badge-ok">🥬 מתאים לצמחונים</span>' : '')}</div>
      ${x.order ? `<p class="pcard-desc"><b>מה להזמין:</b> ${esc(x.order)}</p>` : x.desc ? `<p class="pcard-desc">${esc(x.desc)}</p>` : ''}
    </div>
    <div class="pcard-side">
      <button class="icon-btn fav ${isFav(x.id) ? 'on' : ''}" data-fav="${x.id}" aria-label="מועדף">${icon('heart')}</button>
      <button class="icon-btn" data-add="${x.id}" aria-label="הוספה ללו״ז">${icon('plus')}</button>
    </div>
  </article>`;
}

function filtered() {
  const st = store.state;
  const q = f.q.trim().toLowerCase();
  const wd = f.day ? weekdayOf(f.day) : null;
  const pool = f.type === 'experience'
    ? DB.places.filter(p => p.cat === 'experience' && (p.tags || []).includes('food'))
    : DB.food;
  let list = pool.filter(x => {
    if (f.type === 'kosher' && !x.kosher) return false;
    if (!['all', 'kosher', 'experience'].includes(f.type) && x.type !== f.type) return false;
    if (q && !`${x.name} ${x.orig || ''} ${x.order || ''} ${x.desc || ''}`.toLowerCase().includes(q)) return false;
    if (x.kind === 'food') {
      if (f.diet && !dietOk(x, st.settings.diet) && !['gelato', 'coffee', 'bakery', 'aperitivo', 'wine', 'market', 'grocery'].includes(x.type)) return false;
      if (f.kosher && !x.kosher) return false;
      if (f.veg && (x.veg || 0) < 3) return false;
      if (f.top && !x.top) return false;
      if (f.price && (x.price || 1) > f.price) return false;
    }
    if (f.fav && !isFav(x.id)) return false;
    if (wd != null && closedOn(x, wd)) return false;
    if (f.area && x.area !== f.area) return false;
    return true;
  });
  const hotel = st.settings.hotelId ? get(st.settings.hotelId) : null;
  const ref = f.sort === 'near' ? pos : f.sort === 'hotel' ? hotel : null;
  if (ref) list.sort((a, b) => (distKm(ref, a) ?? 99) - (distKm(ref, b) ?? 99));
  else if (f.sort === 'price') list.sort((a, b) => (a.price || 1) - (b.price || 1));
  else list.sort((a, b) => score(b) - score(a));
  return { list, ref };
}

const score = x => (x.kosher ? 30 : 0) + (x.top ? 20 : 0) + (x.veg || 0) * 4 + (x.tier ? (4 - x.tier) * 5 : 0);

function guideSheet(kind) {
  const n = DB.notes;
  if (kind === 'kosher') {
    const k = n.kosher || {};
    openSheet({
      title: '✡ כשרות ושבת ברומא',
      body: `${k.intro ? `<p>${richText(k.intro)}</p>` : ''}
        ${k.shabbat ? `<div class="tipbox">🕯️ ${richText(k.shabbat)}</div>` : ''}
        ${(k.dishes || []).length ? `<h3 class="h3">מנות רומאיות-יהודיות שכדאי לטעום</h3>
          <div class="dish-list">${k.dishes.map(d => `<div class="dish"><b>${esc(d.he)}</b> <span class="orig" dir="ltr">${esc(d.name)}</span><p>${esc(d.desc)}</p></div>`).join('')}</div>` : ''}
        ${k.dayTrips ? `<h3 class="h3">כשר בטיולי יום</h3><p>${richText(k.dayTrips)}</p>` : ''}`,
    });
    return;
  }
  const v = n.veg || {};
  openSheet({
    title: '🥬 מדריך מהיר לצמחונים',
    body: `${(v.vegClassics || []).length ? `<h3 class="h3">קלאסיקות צמחוניות</h3>
        <div class="dish-list">${v.vegClassics.map(d => `<div class="dish"><b>${esc(d.he)}</b> <span class="orig" dir="ltr">${esc(d.name)}</span><p>${esc(d.desc)}</p></div>`).join('')}</div>` : ''}
      ${v.watchOut ? `<div class="tipbox warnbox">⚠️ ${richText(v.watchOut)}</div>` : ''}
      ${(v.phrases || []).length ? `<h3 class="h3">משפטים באיטלקית</h3>
        <div class="phrases">${v.phrases.map(p => `<div class="phrase"><b dir="ltr">${esc(p.it)}</b><span>${esc(p.he)}</span><small>${esc(p.say)}</small></div>`).join('')}</div>` : ''}
      ${v.etiquette ? `<h3 class="h3">נימוסי שולחן</h3><p>${richText(v.etiquette)}</p>` : ''}`,
  });
}

export function renderFood(root) {
  const st = store.state;
  const areas = [...new Set(DB.food.map(x => x.area).filter(Boolean))];
  root.innerHTML = `
    <div class="guide-row">
      <button class="guide-card" data-guide="kosher"><span>✡</span><b>כשר ושבת</b><small>מה סגור מתי, מנות יהודיות-רומאיות</small></button>
      <button class="guide-card" data-guide="veg"><span>🥬</span><b>מדריך לצמחונים</b><small>מה להזמין וממה להיזהר</small></button>
    </div>
    <div class="search"><span>${icon('search')}</span><input type="search" placeholder="חיפוש מסעדה, מנה, שכונה…" value="${esc(f.q)}" data-q></div>
    <div class="chips-scroll" data-types>${typeChips(DB.food)}</div>
    <div class="filters">
      <button class="chip chip-sm ${f.diet ? 'on' : ''}" data-flag="diet" title="${esc(DIETS[st.settings.diet]?.label || '')}">לפי ההעדפות שלנו</button>
      <button class="chip chip-sm ${f.veg ? 'on' : ''}" data-flag="veg">🥬 צמחוני מעולה</button>
      <button class="chip chip-sm ${f.top ? 'on' : ''}" data-flag="top">⭐ חובה</button>
      <button class="chip chip-sm ${f.fav ? 'on' : ''}" data-flag="fav">♥ מועדפים</button>
      <select class="mini-select" data-day aria-label="פתוח ביום">
        <option value="">פתוח בכל יום</option>
        ${PLANNABLE_DAYS.map(d => `<option value="${d}" ${f.day === d ? 'selected' : ''}>פתוח ב${dayLabel(d)}</option>`).join('')}
      </select>
      <select class="mini-select" data-area aria-label="אזור">
        <option value="">כל האזורים</option>
        ${areas.map(a => `<option value="${a}" ${f.area === a ? 'selected' : ''}>${esc(areaName(a) || a)}</option>`).join('')}
      </select>
      <select class="mini-select" data-price aria-label="מחיר">
        <option value="0">כל המחירים</option>
        ${[1, 2, 3].map(p => `<option value="${p}" ${f.price === p ? 'selected' : ''}>עד ${priceLevel(p)}</option>`).join('')}
      </select>
      <select class="mini-select" data-sort aria-label="מיון">
        <option value="rec" ${f.sort === 'rec' ? 'selected' : ''}>מיון: מומלץ</option>
        <option value="near" ${f.sort === 'near' ? 'selected' : ''}>הכי קרוב אליי</option>
        <option value="hotel" ${f.sort === 'hotel' ? 'selected' : ''}>הכי קרוב למלון</option>
        <option value="price" ${f.sort === 'price' ? 'selected' : ''}>הכי זול</option>
      </select>
    </div>
    <div class="results" data-results></div>`;

  const results = root.querySelector('[data-results]');
  const draw = () => {
    const { list, ref } = filtered();
    results.innerHTML = list.length
      ? `<div class="count muted small">${list.length} מקומות</div>${list.map(x => cardHtml(x, ref)).join('')}`
      : emptyState('אין מקומות שמתאימים לסינון.');
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

  root.querySelectorAll('[data-guide]').forEach(b => b.addEventListener('click', () => guideSheet(b.dataset.guide)));
  root.querySelector('[data-q]').addEventListener('input', ev => { f.q = ev.target.value; draw(); });
  root.querySelectorAll('[data-type]').forEach(b => b.addEventListener('click', () => {
    f.type = b.dataset.type;
    root.querySelectorAll('[data-type]').forEach(x => x.classList.toggle('on', x === b));
    draw();
  }));
  root.querySelectorAll('[data-flag]').forEach(b => b.addEventListener('click', () => {
    f[b.dataset.flag] = !f[b.dataset.flag];
    b.classList.toggle('on', f[b.dataset.flag]);
    draw();
  }));
  root.querySelector('[data-day]').addEventListener('change', ev => { f.day = ev.target.value; draw(); });
  root.querySelector('[data-area]').addEventListener('change', ev => { f.area = ev.target.value; draw(); });
  root.querySelector('[data-price]').addEventListener('change', ev => { f.price = +ev.target.value; draw(); });
  root.querySelector('[data-sort]').addEventListener('change', async ev => {
    f.sort = ev.target.value;
    if (f.sort === 'near' && !pos) pos = await myPosition();
    draw();
  });
  draw();
}
