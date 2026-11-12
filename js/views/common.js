// Shared pieces: entity tiles and badges, the details sheet, "add to day".
import { DB, get, areaName } from '../data.js';
import { store, update, snapshot, undo } from '../store.js';
import { esc, bidi, icon, richText, CATS, FOOD_TYPES, WD_SHORT, WD_LONG, weekdayOf, dm, priceLevel, euro, uid, fmtDur } from '../util.js';
import { TRIP, PLANNABLE_DAYS, FULL_DAYS, closedOn, insertItem, rebuildDay, MEAL_LABEL } from '../planner.js';
import { gmapsPlace, gmapsDir } from '../geo.js';
import { openSheet, toast, confirmSheet } from '../ui.js';

export const dayLabel = date => `${WD_SHORT[weekdayOf(date)]} ${dm(date)}`;

export function emojiOf(e) {
  if (!e) return '📌';
  if (e.icon) return e.icon;
  if (e.kind === 'food') return FOOD_TYPES[e.type]?.emoji || '🍽️';
  if (e.kind === 'hotel') return '🏨';
  if (e.kind === 'daytrip') return '🚆';
  if (e.cat === 'experience' && (e.tags || []).includes('food')) return '👩‍🍳';
  return CATS[e.cat]?.emoji || '📍';
}

export function tile(e, extra = '') {
  return `<div class="tile tile-${esc(e?.kind || 'x')} ${extra}" aria-hidden="true">${emojiOf(e)}</div>`;
}

export const isFav = id => store.state.favs.includes(id);

export function toggleFav(id) {
  update(s => {
    const i = s.favs.indexOf(id);
    if (i >= 0) s.favs.splice(i, 1); else s.favs.push(id);
  }, { silent: true });
  toast(isFav(id) ? 'נשמר במועדפים ♥' : 'הוסר מהמועדפים');
}

// 'required' | 'recommended' | null: tickets for places, a table for restaurants.
export function needsBooking(e) {
  if (!e) return null;
  const v = e.kind === 'food' ? e.reserve : e.booking;
  return v === 'required' || v === 'recommended' ? v : null;
}

const oursBadge = e => (e.wish ? '<span class="badge badge-sky">📍 ברשימה שלנו, עוד לא שובץ</span>'
  : e.ours ? '<span class="badge badge-sky">📍 שלנו</span>' : '');

export function toggleBooked(id) {
  update(s => { if (s.booked[id]) delete s.booked[id]; else s.booked[id] = true; });
}

export function closedDaysText(e) {
  const closed = [];
  for (let wd = 0; wd < 7; wd++) if (closedOn(e, wd)) closed.push(WD_LONG[wd]);
  if (!closed.length) return '';
  if (closed.length === 6) {
    const openDay = [0, 1, 2, 3, 4, 5, 6].find(wd => !closedOn(e, wd));
    return `רק בימי ${WD_LONG[openDay]}`;
  }
  return `סגור בימי ${closed.join(', ')}`;
}

export function placeBadges(e) {
  const b = [oursBadge(e)];
  if (e.tier === 1) b.push('<span class="badge badge-accent">חובה</span>');
  else if (e.tier === 2) b.push('<span class="badge">מומלץ</span>');
  if (e.booking === 'required') b.push(`<span class="badge badge-warn">${icon('ticket')} הזמנה מראש</span>`);
  if (e.indoor) b.push('<span class="badge badge-sky">☔ מקורה</span>');
  if (e.priceEur === 0 || (e.tags || []).includes('free')) b.push('<span class="badge badge-ok">חינם</span>');
  if (store.state.booked[e.id]) b.push(`<span class="badge badge-ok">${icon('check')} הוזמן</span>`);
  return b.join('');
}

export function foodBadges(f) {
  const b = [oursBadge(f)];
  if (f.kosher) {
    const kind = { meat: 'בשרי', dairy: 'חלבי', parve: 'פרווה' }[f.kosher.kind] || '';
    b.push(`<span class="badge badge-kosher">✡ כשר ${kind}</span>`);
  } else if (f.kosherStyle) {
    b.push('<span class="badge badge-warn">בסגנון יהודי · לא כשר</span>');
  }
  if ((f.veg || 0) >= 3) b.push('<span class="badge badge-ok">🥬 מעולה לצמחונים</span>');
  else if ((f.veg || 0) === 2) b.push('<span class="badge badge-ok">🥬 אופציות צמחוניות</span>');
  if (f.top) b.push('<span class="badge badge-accent">⭐ חובה לטעום</span>');
  if (f.reserve === 'required') b.push('<span class="badge badge-warn">להזמין מקום</span>');
  return b.join('');
}

function linkBtn(href, label, ic = 'external') {
  if (!href) return '';
  return `<a class="btn btn-soft btn-sm" href="${esc(href)}" target="_blank" rel="noopener">${icon(ic)}${esc(label)}</a>`;
}

export function bookingSearchUrl(h) {
  if (h.bookingUrl) return h.bookingUrl;
  const q = encodeURIComponent(`${h.name}, Rome`);
  return `https://www.booking.com/searchresults.he.html?ss=${q}&checkin=${TRIP.dates[0]}&checkout=${TRIP.dates[5]}&group_adults=2&no_rooms=1&group_children=0`;
}

function factRow(label, value) {
  return value ? `<div class="fact"><span>${label}</span><div>${value}</div></div>` : '';
}

function dayButtons(e) {
  const st = store.state;
  const days = e.kind === 'daytrip' ? FULL_DAYS : PLANNABLE_DAYS;
  return days.map(date => {
    const wd = weekdayOf(date);
    const day = st.days?.find(d => d.date === date);
    const already = day?.items.some(i => i.id === e.id);
    let note = '', disabled = false;
    if (e.kind !== 'hotel' && closedOn(e, wd)) { note = 'סגור'; disabled = e.kind !== 'daytrip'; }
    if (e.days && !e.days.includes(date)) { note = 'לא בתאריך'; disabled = true; }
    if (already) note = '✓ בתוכנית';
    return `<button class="daybtn ${already ? 'on' : ''}" data-add-day="${date}" ${disabled ? 'disabled' : ''}>
      <b>${dayLabel(date)}</b><small>${note || '&nbsp;'}</small></button>`;
  }).join('');
}

function detailBody(e) {
  const st = store.state;
  const parts = [];
  const area = areaName(e.area);
  const head = `
    <div class="detail-head">
      ${tile(e, 'tile-lg')}
      <div>
        <div class="detail-orig" dir="ltr">${esc(e.orig || '')}</div>
        <div class="detail-sub">${esc(area)}${e.kind === 'food' ? ` · ${esc(FOOD_TYPES[e.type]?.he || '')} · ${priceLevel(e.price)}` : ''}</div>
      </div>
      <button class="icon-btn fav ${isFav(e.id) ? 'on' : ''}" data-fav aria-label="מועדף">${icon('heart')}</button>
    </div>`;
  parts.push(head);
  parts.push(`<div class="badges">${e.kind === 'food' ? foodBadges(e) : e.kind === 'place' ? placeBadges(e) : ''}</div>`);
  if (e.desc) parts.push(`<p class="detail-desc">${richText(e.desc)}</p>`);

  if (e.kind === 'daytrip') {
    parts.push(`<div class="facts">
      ${factRow('איך מגיעים', richText(e.travel))}
      ${factRow('עלות', [e.costEur ? `נסיעה כ-${euro(e.costEur)} לאדם הלוך-חזור` : '', e.entryEur ? `כניסות כ-${euro(e.entryEur)} לאדם` : ''].filter(Boolean).join(' · '))}
      ${factRow('הזמנות', richText(e.booking))}
      ${factRow('ימים', [closedDaysText(e) ? `האתרים המרכזיים: ${closedDaysText(e)}` : '', (e.bestDays || []).length ? `מומלץ: ${e.bestDays.map(d => WD_LONG[d]).join(', ')}` : ''].filter(Boolean).join(' · '))}
      ${factRow('אוכל', richText(e.food))}
    </div>`);
    if ((e.highlights || []).length) parts.push(`<h3 class="h3">מה רואים</h3><ul class="bullets">${e.highlights.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`);
    if ((e.plan || []).length) parts.push(`<h3 class="h3">לו״ז מוצע</h3><ol class="mini-tl">${e.plan.map(p => `<li><b>${esc(p.t)}</b><span>${esc(p.x)}</span></li>`).join('')}</ol>`);
  } else if (e.kind === 'food') {
    parts.push(`<div class="facts">
      ${factRow('מה להזמין', richText(e.order))}
      ${e.kosher ? factRow('כשרות', esc([e.kosher.cert, e.kosher.shabbat ? 'סגור בשבת' : ''].filter(Boolean).join(' · '))) : ''}
      ${factRow('שעות', bidi(e.hours))}
      ${factRow('הזמנת מקום', { required: 'חובה להזמין מראש', recommended: 'מומלץ להזמין', no: 'לא צריך' }[e.reserve] || '')}
      ${factRow('כתובת', esc(e.address))}
    </div>`);
  } else if (e.kind === 'place') {
    const booking = e.booking === 'required' ? 'חובה להזמין מראש' : e.booking === 'recommended' ? 'מומלץ להזמין' : '';
    parts.push(`<div class="facts">
      ${factRow('שעות', bidi(e.hours) + (closedDaysText(e) ? `<br><b class="warn-text">${esc(closedDaysText(e))}</b>` : ''))}
      ${factRow('מחיר', bidi(e.price))}
      ${factRow('כמה זמן', e.dur ? fmtDur(e.dur) : '')}
      ${factRow('כרטיסים', booking)}
      ${e.dates ? factRow('תאריכים', esc(e.dates)) : ''}
      ${e.provider ? factRow('מפעיל', esc(e.provider)) : ''}
      ${factRow('כתובת', esc(e.address))}
    </div>`);
  }
  if (e.tips) parts.push(`<div class="tipbox">💡 ${richText(e.tips)}</div>`);

  const links = [
    e.bookUrl ? linkBtn(e.bookUrl, 'הזמנת כרטיסים', 'ticket') : '',
    linkBtn(e.url, 'אתר רשמי'),
    e.lat != null ? linkBtn(gmapsPlace(e), 'Google Maps', 'pin') : '',
    e.lat != null ? linkBtn(gmapsDir(e), 'ניווט', 'nav') : '',
    e.phone ? `<a class="btn btn-soft btn-sm" href="tel:${esc(e.phone.replace(/\s/g, ''))}">${icon('phone')}${esc(e.phone)}</a>` : '',
  ].join('');
  parts.push(`<div class="link-row">${links}</div>`);
  if (needsBooking(e)) {
    parts.push(`<label class="check-line"><input type="checkbox" data-booked ${st.booked[e.id] ? 'checked' : ''}> ${e.kind === 'food' ? 'הזמנו מקום ✓' : 'הזמנו כרטיסים ✓'}</label>`);
  }

  if (e.kind === 'food') {
    const meals = e.meals?.length ? e.meals : ['lunch', 'dinner'];
    const def = meals.includes('dinner') ? 'dinner' : meals[0];
    parts.push(`<h3 class="h3">להוסיף ללו״ז</h3>
      <div class="seg seg-sm" data-meal-seg>${['lunch', 'dinner', 'snack'].map(m =>
        `<button class="${m === def ? 'on' : ''}" data-meal="${m}">${MEAL_LABEL[m]}</button>`).join('')}</div>
      <div class="daybtns">${dayButtons(e)}</div>`);
  } else if (e.kind === 'daytrip') {
    parts.push(`<h3 class="h3">לקבוע כטיול יום</h3><div class="daybtns">${dayButtons(e)}</div>
      <p class="muted small">זה יחליף את התוכנית של אותו יום.</p>`);
  } else if (e.kind === 'place') {
    parts.push(`<h3 class="h3">להוסיף ללו״ז</h3><div class="daybtns">${dayButtons(e)}</div>`);
  }
  if (e.verified === false && e.note) parts.push(`<p class="muted small">ℹ️ חלק מהפרטים לא אומתו סופית — כדאי לבדוק באתר הרשמי.</p>`);
  return parts.join('');
}

export function addEntityToDay(e, date, meal = null) {
  if (e.kind === 'daytrip') {
    snapshot();
    update(s => {
      rebuildDay(s, date, 'daytrip:' + e.id);
      s.settings.dayTrip = { id: e.id, date };
    });
    toast(`${e.name} נקבע ל${dayLabel(date)}`, { action: 'ביטול', onAction: undo });
    return;
  }
  update(s => {
    const day = s.days.find(d => d.date === date);
    if (!day) return;
    const item = { u: uid(), t: e.kind === 'food' ? 'food' : 'place', id: e.id };
    if (e.kind === 'food') item.meal = meal || 'snack';
    insertItem(day, item);
  });
  toast(`נוסף ל${dayLabel(date)}`, { action: 'ללו״ז', onAction: () => { location.hash = `#/plan/${date}`; } });
}

export function openDetail(id) {
  const e = get(id);
  if (!e) return;
  openSheet({
    title: e.name,
    body: detailBody(e),
    cls: 'sheet-detail',
    onMount(body, close) {
      let meal = body.querySelector('[data-meal-seg] .on')?.dataset.meal || null;
      body.querySelectorAll('[data-meal]').forEach(b => b.addEventListener('click', () => {
        body.querySelectorAll('[data-meal]').forEach(x => x.classList.toggle('on', x === b));
        meal = b.dataset.meal;
      }));
      body.querySelector('[data-fav]')?.addEventListener('click', ev => {
        toggleFav(id);
        ev.currentTarget.classList.toggle('on', isFav(id));
      });
      body.querySelector('[data-booked]')?.addEventListener('change', () => toggleBooked(id));
      body.querySelectorAll('[data-add-day]').forEach(b => b.addEventListener('click', async () => {
        const date = b.dataset.addDay;
        if (e.kind === 'daytrip') {
          const ok = await confirmSheet({ title: `טיול יום ל${dayLabel(date)}?`, text: 'התוכנית של היום הזה תוחלף בטיול. אפשר לבטל מיד אחרי.', ok: 'קבע' });
          if (!ok) return;
          close();
          addEntityToDay(e, date);
          return;
        }
        addEntityToDay(e, date, meal);
        b.classList.add('on');
        b.querySelector('small').textContent = '✓ בתוכנית';
      }));
    },
  });
}

export function emptyState(text) {
  return `<div class="empty">${esc(text)}</div>`;
}

export { DB };
