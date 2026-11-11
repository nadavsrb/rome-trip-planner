// Hotels: neighborhood guide, filters, sort by price/rating/commute, side-by-side compare.
import { DB, get, areaName } from '../data.js';
import { store, update } from '../store.js';
import { esc, ltr, icon, euro, richText } from '../util.js';
import { hotelCommute } from '../planner.js';
import { leg, gmapsPlace } from '../geo.js';
import { openSheet, toast } from '../ui.js';
import { bookingSearchUrl, emptyState } from './common.js';

const NIGHTS = 5;
const LANDMARKS = [
  { id: 'pantheon', he: 'פנתיאון', lat: 41.8986, lng: 12.4769 },
  { id: 'colosseum', he: 'קולוסיאום', lat: 41.8902, lng: 12.4922 },
  { id: 'vatican', he: 'ותיקן', lat: 41.9022, lng: 12.4539 },
  { id: 'termini', he: 'טרמיני', lat: 41.9009, lng: 12.5013 },
];
const FEATURES = {
  breakfast: 'ארוחת בוקר', rooftop: 'גג', terrace: 'מרפסת', view: 'נוף', quiet: 'שקט', boutique: 'בוטיק',
  'family-run': 'משפחתי', elevator: 'מעלית', gym: 'חדר כושר', spa: 'ספא', pool: 'בריכה', bar: 'בר',
  restaurant: 'מסעדה', ac: 'מיזוג', accessible: 'נגיש',
};
const FEATURE_FILTERS = [['breakfast', 'ארוחת בוקר כלולה'], ['rooftop', 'גג/מרפסת'], ['quiet', 'שקט'], ['boutique', 'בוטיק'], ['spa', 'ספא/בריכה']];

const f = { max: 0, stars: [], rating: 0, area: '', feats: [], sort: 'rec' };

const mid = h => ((h.priceLow || 0) + (h.priceHigh || h.priceLow || 0)) / 2;
const hasFeat = (h, k) => {
  if (k === 'breakfast') return h.breakfastIncluded === true;
  if (k === 'rooftop') return (h.features || []).some(x => x === 'rooftop' || x === 'terrace');
  if (k === 'spa') return (h.features || []).some(x => x === 'spa' || x === 'pool');
  return (h.features || []).includes(k);
};

function priceText(h) {
  if (!h.priceLow) return 'מחיר לא ידוע';
  const range = h.priceHigh && h.priceHigh !== h.priceLow ? `${euro(h.priceLow)}–${euro(h.priceHigh)}` : euro(h.priceLow);
  return `${ltr(range)} ללילה`;
}

function distances(h) {
  return LANDMARKS.map(l => {
    const g = leg(h, l);
    return { ...l, min: g?.min, mode: g?.mode };
  });
}

function distLine(h) {
  return distances(h).map(d => `<span>${d.mode === 'walk' ? '🚶' : '🚕'} ${d.he} ${d.min}′</span>`).join('');
}

function stars(n) { return n ? '★'.repeat(n) : ''; }

function cardHtml(h, st) {
  const chosen = st.settings.hotelId === h.id;
  const inCmp = st.compare.includes(h.id);
  const commute = hotelCommute(h, st);
  const feats = (h.features || []).slice(0, 6).map(k => `<span class="feat">${esc(FEATURES[k] || k)}</span>`).join('');
  return `<article class="hcard ${chosen ? 'chosen' : ''}" data-h="${h.id}">
    <div class="hcard-top">
      <div>
        <div class="hcard-name"><b>${esc(h.name)}</b> <span class="stars">${stars(h.stars)}</span></div>
        <div class="muted small">${esc(areaName(h.area))}</div>
      </div>
      ${h.rating ? `<div class="score"><b>${h.rating}</b><small>${esc(h.ratingSrc || '')}${h.reviews ? ` · ${Number(h.reviews).toLocaleString('en-US')}` : ''}</small></div>` : ''}
    </div>
    <div class="hcard-price"><b>${priceText(h)}</b>${h.priceLow ? `<span class="muted"> · כ-${euro(mid(h) * NIGHTS)} ל-${NIGHTS} לילות</span>` : ''}
      ${h.verified ? '' : '<span class="badge badge-warn">הערכה</span>'}${h.breakfastIncluded ? '<span class="badge badge-ok">כולל ארוחת בוקר</span>' : ''}</div>
    <div class="dist-line">${distLine(h)}</div>
    ${commute != null ? `<div class="commute">🧭 בממוצע כ-${commute} דק׳ ביום מהמלון ללו״ז שלכם וחזרה</div>` : ''}
    ${h.desc ? `<p class="pcard-desc">${esc(h.desc)}</p>` : ''}
    <div class="feats">${feats}</div>
    <details class="proscons"><summary>יתרונות וחסרונות</summary>
      ${h.pros ? `<p>👍 ${richText(h.pros)}</p>` : ''}${h.cons ? `<p>👎 ${richText(h.cons)}</p>` : ''}
    </details>
    <div class="link-row">
      <a class="btn btn-primary btn-sm" href="${bookingSearchUrl(h)}" target="_blank" rel="noopener">${icon('external')}Booking עם התאריכים</a>
      ${h.url ? `<a class="btn btn-soft btn-sm" href="${esc(h.url)}" target="_blank" rel="noopener">אתר המלון</a>` : ''}
      <a class="btn btn-soft btn-sm" href="${gmapsPlace(h)}" target="_blank" rel="noopener">${icon('pin')}מפה</a>
    </div>
    <div class="hcard-actions">
      <label class="check-line"><input type="checkbox" data-cmp="${h.id}" ${inCmp ? 'checked' : ''}> השוואה</label>
      <button class="btn ${chosen ? 'btn-ok' : 'btn-soft'} btn-sm" data-choose="${h.id}">${chosen ? `${icon('check')}המלון שלנו` : 'זה המלון שלנו'}</button>
    </div>
  </article>`;
}

function filtered(st) {
  let list = DB.hotels.filter(h => {
    if (f.max && (h.priceLow || 0) > f.max) return false;
    if (f.stars.length && !f.stars.includes(h.stars)) return false;
    if (f.rating && (h.rating || 0) < f.rating) return false;
    if (f.area && h.area !== f.area) return false;
    if (f.feats.some(k => !hasFeat(h, k))) return false;
    return true;
  });
  const key = {
    price: h => mid(h) || 9999,
    rating: h => -(h.rating || 0),
    commute: h => hotelCommute(h, st) ?? 999,
    pantheon: h => distances(h)[0].min, colosseum: h => distances(h)[1].min,
    vatican: h => distances(h)[2].min, termini: h => distances(h)[3].min,
    // Value for money: rating against price, nudged by distance from the plan.
    rec: h => -(h.rating || 0) * 10 + (mid(h) || 300) / 40 + (hotelCommute(h, st) ?? 60) / 4,
  }[f.sort];
  return list.sort((a, b) => key(a) - key(b));
}

function areaCards() {
  if (!DB.areas.length) return '';
  return `<div class="areas-scroll">${DB.areas.map(a => `
    <button class="area-card ${f.area === a.id ? 'on' : ''}" data-area="${a.id}">
      <b>${esc(a.name)}</b><small>${'€'.repeat(a.priceLevel || 2)} · ${esc(a.bestFor || '')}</small>
      <p>${esc(a.vibe || '')}</p>
    </button>`).join('')}</div>`;
}

function openArea(id) {
  const a = DB.areas.find(x => x.id === id);
  if (!a) return;
  openSheet({
    title: a.name,
    body: `<p>${richText(a.vibe)}</p>
      <div class="facts">
        <div class="fact"><span>יתרונות</span><div>${richText(a.pros)}</div></div>
        <div class="fact"><span>חסרונות</span><div>${richText(a.cons)}</div></div>
        <div class="fact"><span>מתאים ל</span><div>${richText(a.bestFor)}</div></div>
        <div class="fact"><span>מרחקים</span><div>${richText(a.walk)}</div></div>
      </div>`,
  });
}

function compareSheet(st) {
  const hs = st.compare.map(get).filter(Boolean);
  if (hs.length < 2) { toast('סמנו לפחות שני מלונות להשוואה'); return; }
  const rows = [
    ['מחיר ללילה', h => priceText(h)],
    [`סה״כ ל-${NIGHTS} לילות`, h => (h.priceLow ? `כ-${euro(mid(h) * NIGHTS)}` : '—')],
    ['דירוג', h => (h.rating ? `<b>${h.rating}</b> ${esc(h.ratingSrc || '')}` : '—')],
    ['כוכבים', h => stars(h.stars) || '—'],
    ['אזור', h => esc(areaName(h.area))],
    ['ארוחת בוקר', h => (h.breakfastIncluded ? '✓ כלולה' : h.breakfastIncluded === false ? 'לא כלולה' : '?')],
    ['נסיעות ביום ללו״ז', h => { const c = hotelCommute(h, st); return c != null ? `כ-${c} דק׳` : '—'; }],
    ...LANDMARKS.map((l, i) => [l.he, h => { const d = distances(h)[i]; return `${d.mode === 'walk' ? '🚶' : '🚕'} ${d.min} דק׳`; }]),
    ['מה יש', h => (h.features || []).map(k => FEATURES[k] || k).join(', ')],
    ['יתרונות', h => richText(h.pros || '')],
    ['חסרונות', h => richText(h.cons || '')],
    ['', h => `<a class="btn btn-primary btn-sm" href="${bookingSearchUrl(h)}" target="_blank" rel="noopener">Booking</a>`],
  ];
  openSheet({
    title: 'השוואת מלונות',
    cls: 'sheet-tall',
    body: `<div class="cmp-wrap"><table class="cmp">
      <thead><tr><th></th>${hs.map(h => `<th>${esc(h.name)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(([label, fn]) => `<tr><th>${label}</th>${hs.map(h => `<td>${fn(h)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <button class="btn btn-soft btn-block" data-clear>ניקוי ההשוואה</button>`,
    onMount(body, close) {
      body.querySelector('[data-clear]').addEventListener('click', () => { update(s => { s.compare = []; }); close(); });
    },
  });
}

export function renderHotels(root) {
  const st = store.state;
  const chosen = st.settings.hotelId ? get(st.settings.hotelId) : null;
  const maxPrice = Math.max(400, ...DB.hotels.map(h => h.priceLow || 0));
  root.innerHTML = `
    ${chosen ? `<div class="card chosen-hotel">🏨 המלון שלכם: <b>${esc(chosen.name)}</b>
        <button class="btn btn-soft btn-sm" data-unchoose>החלפה</button></div>`
      : `<div class="card prompt"><b>🏨 עוד לא בחרתם מלון</b><small class="muted">כשתבחרו, הלו״ז יחשב זמני יציאה וחזרה מהמלון, ותראו כמה כל מלון קרוב לתוכנית שלכם.</small></div>`}
    <h2 class="h2">שכונות</h2>
    ${areaCards()}
    <h2 class="h2">מלונות <small class="muted">${DB.hotels.length}</small></h2>
    <div class="filters filters-wrap">
      <label class="range-field"><span>עד ${f.max ? euro(f.max) : 'כל מחיר'} ללילה</span>
        <input type="range" min="100" max="${maxPrice}" step="25" value="${f.max || maxPrice}" data-max></label>
      ${[3, 4, 5].map(n => `<button class="chip chip-sm ${f.stars.includes(n) ? 'on' : ''}" data-star="${n}">${'★'.repeat(n)}</button>`).join('')}
      <select class="mini-select" data-rating aria-label="דירוג מינימלי">
        <option value="0">כל דירוג</option>
        ${[8.5, 9, 9.3].map(r => `<option value="${r}" ${f.rating === r ? 'selected' : ''}>${r}+</option>`).join('')}
      </select>
      ${FEATURE_FILTERS.map(([k, l]) => `<button class="chip chip-sm ${f.feats.includes(k) ? 'on' : ''}" data-feat="${k}">${l}</button>`).join('')}
      <select class="mini-select" data-sort aria-label="מיון">
        <option value="rec" ${f.sort === 'rec' ? 'selected' : ''}>מיון: תמורה למחיר</option>
        <option value="price" ${f.sort === 'price' ? 'selected' : ''}>מחיר</option>
        <option value="rating" ${f.sort === 'rating' ? 'selected' : ''}>דירוג</option>
        <option value="commute" ${f.sort === 'commute' ? 'selected' : ''}>הכי קרוב ללו״ז שלנו</option>
        ${LANDMARKS.map(l => `<option value="${l.id}" ${f.sort === l.id ? 'selected' : ''}>הכי קרוב ל${l.he}</option>`).join('')}
      </select>
      ${f.area ? `<button class="chip chip-sm on" data-area-clear>${esc(areaName(f.area))} ✕</button>` : ''}
    </div>
    <div class="results" data-results></div>
    <div class="cmp-bar ${st.compare.length >= 2 ? 'show' : ''}"><button class="btn btn-primary" data-compare>${icon('compare')}השוואה (${st.compare.length})</button></div>`;

  const results = root.querySelector('[data-results]');
  const draw = () => {
    const list = filtered(store.state);
    results.innerHTML = list.length ? list.map(h => cardHtml(h, store.state)).join('') : emptyState('אין מלונות שמתאימים לסינון — נסו להרחיב.');
    results.querySelectorAll('[data-choose]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.choose;
      update(s => { s.settings.hotelId = s.settings.hotelId === id ? null : id; });
      if (store.state.settings.hotelId) toast('המלון נקבע — הלו״ז מחושב ממנו');
    }));
    results.querySelectorAll('[data-cmp]').forEach(cb => cb.addEventListener('change', () => {
      update(s => {
        const i = s.compare.indexOf(cb.dataset.cmp);
        if (i >= 0) s.compare.splice(i, 1); else s.compare.push(cb.dataset.cmp);
      });
    }));
  };

  root.querySelector('[data-unchoose]')?.addEventListener('click', () => update(s => { s.settings.hotelId = null; }));
  root.querySelectorAll('[data-area]').forEach(b => b.addEventListener('click', () => {
    if (f.area === b.dataset.area) { openArea(b.dataset.area); return; }
    f.area = b.dataset.area;
    renderHotels(root);
  }));
  root.querySelector('[data-area-clear]')?.addEventListener('click', () => { f.area = ''; renderHotels(root); });
  const range = root.querySelector('[data-max]');
  range.addEventListener('input', () => {
    f.max = +range.value >= maxPrice ? 0 : +range.value;
    range.previousElementSibling.textContent = `עד ${f.max ? euro(f.max) : 'כל מחיר'} ללילה`;
    draw();
  });
  root.querySelectorAll('[data-star]').forEach(b => b.addEventListener('click', () => {
    const n = +b.dataset.star;
    f.stars = f.stars.includes(n) ? f.stars.filter(x => x !== n) : [...f.stars, n];
    b.classList.toggle('on');
    draw();
  }));
  root.querySelector('[data-rating]').addEventListener('change', ev => { f.rating = +ev.target.value; draw(); });
  root.querySelectorAll('[data-feat]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.feat;
    f.feats = f.feats.includes(k) ? f.feats.filter(x => x !== k) : [...f.feats, k];
    b.classList.toggle('on');
    draw();
  }));
  root.querySelector('[data-sort]').addEventListener('change', ev => { f.sort = ev.target.value; draw(); });
  root.querySelector('[data-compare]').addEventListener('click', () => compareSheet(store.state));
  draw();
}
