// The day-by-day schedule: day chips, a "now / next" card, the timeline with walking
// legs and warnings, alternatives, done marks, editing, and the day's Google Maps route.
import { DB, get } from '../data.js';
import { store, update, snapshot, undo } from '../store.js';
import { esc, ltr, bidi, icon, fromMin, toMin, fmtDur, fmtKm, WD_LONG, WD_SHORT, weekdayOf, dm, romeToday, romeNowMin, uid, priceLevel, FOOD_TYPES } from '../util.js';
import {
  TRIP, PLANNABLE_DAYS, computeDay, rankFood, insertItem, MEAL_LABEL, closedOn, checkOpen, locOf, nearestLoc,
  scheduleDays, sortByPins,
} from '../planner.js';
import { gmapsDir, distKm, leg as legOf, centroid } from '../geo.js';
import { dayWeather, wxIcon, wxText, CLIMATE, wx, hourWeather, rainSpans, wetness } from '../weather.js';
import { openSheet, toast, confirmSheet } from '../ui.js';
import { openDetail, emojiOf, foodBadges, dayLabel, toggleBooked, needsBooking, tile } from './common.js';
import { focusMapDay } from './map.js';

let current = null;

export function selectedDate(param) {
  if (param && TRIP.dates.includes(param)) current = param;
  if (!current) {
    const today = romeToday();
    current = TRIP.dates.includes(today) ? today : (sessionStorage.getItem('rome26:day') || TRIP.dates[0]);
    if (!TRIP.dates.includes(current)) current = TRIP.dates[0];
  }
  try { sessionStorage.setItem('rome26:day', current); } catch { /* ignore */ }
  return current;
}

const dayIndex = date => TRIP.dates.indexOf(date);
const hotelOf = st => (st.settings.hotelId ? get(st.settings.hotelId) : null);

function dayChips(active) {
  return TRIP.dates.map((date, i) => {
    const w = dayWeather(date);
    const tag = i === 0 ? 'נחיתה' : i === 5 ? 'טיסה' : (w ? `${wxIcon(w.code)} ${w.tmax}°` : '');
    return `<a href="#/plan/${date}" class="daychip ${date === active ? 'on' : ''}" style="--dc:var(--day${i})" role="tab" aria-selected="${date === active}">
      <b>${WD_SHORT[weekdayOf(date)]} ${dm(date)}</b><small>${tag}</small></a>`;
  }).join('');
}

function warnHtml(list) {
  return list.map(w => `<div class="warn warn-${w.lvl}" ${w.type === 'book' ? 'data-book' : ''}>${w.lvl === 'lo' ? '•' : '⚠️'} ${esc(w.text)}</div>`).join('');
}

function legHtml(ci, prevLoc) {
  const l = ci.leg;
  if (!l || l.min < 2) return '';
  const icon_ = l.mode === 'walk' ? '🚶' : '🚕/🚇';
  const label = l.mode === 'walk' ? `${l.min} דק׳ הליכה · ${fmtKm(l.km)}` : `כ-${l.min} דק׳ במונית/מטרו (${l.walk} דק׳ ברגל)`;
  const href = ci.loc && prevLoc ? gmapsDir(ci.loc, prevLoc, l.mode === 'walk' ? 'walking' : 'transit') : '';
  return `<div class="leg">${icon_} ${label}${href ? ` · <a href="${href}" target="_blank" rel="noopener">מסלול</a>` : ''}</div>`;
}

const FIXED_EMOJI = { flight: '✈️', airport: '🛂', transfer: '🚕', hotel: '🏨' };

export function itemTitle(ci) {
  const e = ci.e;
  if (ci.t === 'fixed') return { emoji: FIXED_EMOJI[ci.kind] || '📌', name: ci.title };
  if (ci.t === 'custom') return { emoji: '📌', name: ci.title || 'פריט אישי' };
  if (ci.t === 'meal') return { emoji: '🍽️', name: `${MEAL_LABEL[ci.meal] || 'ארוחה'}: בחרו מקום` };
  if (!e) return { emoji: '❔', name: 'פריט שנמחק מהמאגר' };
  return { emoji: emojiOf(e), name: ci.title || e.name };
}

function itemSub(ci) {
  const e = ci.e, bits = [];
  if (ci.t === 'food') {
    bits.push(MEAL_LABEL[ci.meal] || '');
    if (e) bits.push(priceLevel(e.price));
  } else if (ci.t === 'place' && e) {
    bits.push(fmtDur(ci.dur));
    if (e.price && e.priceEur !== 0) bits.push(bidi(e.price));
  } else if (ci.t !== 'fixed' && ci.dur) bits.push(fmtDur(ci.dur));
  if (ci.fav) bits.push('♥ מהמועדפים');
  return bits.filter(Boolean).join(' · ');
}

// The other options for the same slot ("Pastasciutta / Spizzica"): tap one to switch.
function altsHtml(ci, wd) {
  if (!(ci.alts?.length > 1)) return '';
  return `<div class="alt-row" role="group" aria-label="אופציות למשבצת">${ci.alts.map(id => {
    const a = get(id);
    if (!a) return '';
    const chk = checkOpen(a, wd, ci.start, ci.start + Math.min(ci.dur, 30));
    const bad = !chk.ok;
    const pic = a.img ? `<img class="alt-img" src="${esc(a.img.s)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
    return `<button class="alt-chip ${id === ci.id ? 'on' : ''} ${bad ? 'bad' : ''}" data-alt="${esc(id)}" aria-pressed="${id === ci.id}">
      ${pic}${id === ci.id ? icon('check', 'ic-xs') : ''}${esc(a.name)}${bad ? ' · סגור בשעה הזו' : ''}</button>`;
  }).join('')}</div>`;
}

function itemHtml(ci, idx, items, st, prevLoc, nowMin, wd) {
  const { emoji, name } = itemTitle(ci);
  const fixed = ci.t === 'fixed';
  const isNow = nowMin != null && !ci.done && nowMin >= ci.start && nowMin < ci.end;
  const gap = ci.gap >= 20 && !fixed ? `<div class="gap">⏳ ${fmtDur(ci.gap)} פנויות${ci.meal === 'dinner' && ci.gap >= 60 ? ': זמן לאפריטיבו או מנוחה במלון' : ''}</div>` : '';
  const openAttr = ci.e && ci.e.kind !== 'hotel' ? `data-open="${esc(ci.e.id)}"` : (ci.t === 'meal' ? `data-pickfood="${ci.u}"` : '');
  return `<li class="tl-item ${fixed ? 'fixed' : ''} t-${ci.t} ${isNow ? 'now' : ''} ${ci.done ? 'done' : ''}" data-u="${ci.u}">
    ${legHtml(ci, prevLoc)}${gap}
    <div class="tl-card">
      <div class="tl-time"><b>${fromMin(ci.start)}</b>${ci.end > ci.start ? `<small>${fromMin(ci.end)}</small>` : ''}</div>
      ${ci.e?.img && (ci.t === 'place' || ci.t === 'food') ? `<div class="tl-thumb" ${openAttr}>${tile(ci.e, 'tile-sm')}</div>` : ''}
      <div class="tl-main" ${openAttr}>
        <div class="tl-title"><span class="tl-emoji">${emoji}</span>${esc(name)}${isNow ? ' <span class="badge badge-accent">עכשיו</span>' : ''}${ci.done ? ' <span class="badge badge-ok">✓ בוצע</span>' : ''}</div>
        ${itemSub(ci) ? `<div class="tl-sub">${itemSub(ci)}</div>` : ''}
        ${ci.note ? `<div class="tl-note">${bidi(ci.note)}</div>` : ''}
        ${altsHtml(ci, wd)}
        ${ci.t === 'daytrip' && ci.e ? `<ol class="mini-tl">${(ci.e.plan || []).map(p => `<li><b>${esc(p.t)}</b><span>${esc(p.x)}</span></li>`).join('')}</ol>` : ''}
        ${warnHtml(ci.done ? [] : ci.warns)}
        ${!ci.done && ['outdoor', 'view', 'street', 'boat'].includes(ci.wxExp) && ci.warns.some(w => w.type === 'wx' && w.lvl !== 'lo')
          ? `<button class="chip chip-sm wx-alt" data-indoor="${ci.u}">🏛️ חלופה מקורה בסביבה</button>` : ''}
        ${ci.hints.map(h => `<div class="hint">${esc(h)}</div>`).join('')}
        ${ci.t === 'meal' ? mealSuggestions(ci, items, idx, st) : ''}
      </div>
      <div class="tl-ctrl">
        <button class="icon-btn done-btn ${ci.done ? 'on' : ''}" data-done="${ci.u}" aria-label="${ci.done ? 'ביטול סימון' : 'סימון שעשינו'}" aria-pressed="${!!ci.done}">${icon('check')}</button>
        <button class="icon-btn" data-menu="${ci.u}" aria-label="עריכה ופעולות">${icon('more')}</button>
        ${fixed ? '' : `<button class="grip" aria-label="גרירה לשינוי סדר">${icon('grip')}</button>`}
      </div>
    </div>
  </li>`;
}

function mealSuggestions(ci, items, idx, st) {
  const near = nearestLoc(items, idx) || TRIP.center;
  const used = new Set(st.days.flatMap(d => d.items.filter(i => i.t === 'food').map(i => i.id)));
  const top = rankFood({ meal: ci.meal, near, wd: weekdayOf(current), time: ci.start, diet: st.settings.diet, exclude: used }).slice(0, 3);
  if (!top.length) return '<div class="muted small">לא נמצאה הצעה מתאימה. לחצו כדי לבחור ידנית</div>';
  return `<div class="suggest">${top.map(r => `<button class="chip chip-sm" data-setfood="${r.f.id}">${FOOD_TYPES[r.f.type]?.emoji || '🍽️'} ${esc(r.f.name)}</button>`).join('')}</div>`;
}

// ---------- bookings ----------

function bookingRows(st) {
  const rows = [];
  const seen = new Set();
  for (const d of st.days) for (const it of d.items) {
    const e = it.id && get(it.id);
    if (!e || seen.has(e.id) || !needsBooking(e)) continue;
    seen.add(e.id);
    rows.push({ e, date: d.date, req: needsBooking(e) === 'required' });
  }
  return rows;
}

function bookingAlert(st) {
  const need = bookingRows(st).filter(r => r.req && !st.booked[r.e.id]);
  if (!need.length) return '';
  const names = need.slice(0, 4).map(r => r.e.name).join(', ');
  return `<button class="alert-card" data-act="bookings">🎟️ <span><b>${need.length} הזמנות שעוד לא סימנתם</b><small>${esc(names)}${need.length > 4 ? '…' : ''}</small></span>${icon('chevL')}</button>`;
}

export function openBookings() {
  const st = store.state;
  const rows = bookingRows(st);
  openSheet({
    title: 'מה צריך להזמין מראש',
    body: rows.length ? `<p class="muted small">סמנו ✓ כשהזמנתם (או כשאתם מוותרים), וההתראות בלו״ז ייעלמו.</p>
      <div class="book-list">${rows.map(({ e, date, req }) => `
        <div class="book-row">
          <label class="check-line"><input type="checkbox" data-bk="${e.id}" ${st.booked[e.id] ? 'checked' : ''}>
            <span><b>${esc(e.name)}</b><small>${dayLabel(date)} · ${e.kind === 'food' ? 'הזמנת מקום' : 'כרטיסים'}${req ? ' · חובה' : ' · מומלץ'}</small></span></label>
          ${e.phone ? `<a class="btn btn-soft btn-sm" href="tel:${esc(e.phone.replace(/\s/g, ''))}">${icon('phone')}</a>` : ''}
          ${e.bookUrl || e.url ? `<a class="btn btn-soft btn-sm" href="${esc(e.bookUrl || e.url)}" target="_blank" rel="noopener">${icon('external')}להזמנה</a>` : ''}
        </div>`).join('')}</div>` : '<div class="empty">אין כרגע בלו״ז דברים שצריך להזמין מראש 🎉</div>',
    onMount(body) {
      body.querySelectorAll('[data-bk]').forEach(cb => cb.addEventListener('change', () => toggleBooked(cb.dataset.bk)));
    },
  });
}

// ---------- "now / next" ----------

function nowState(st) {
  const today = romeToday();
  if (!TRIP.dates.includes(today)) return null;
  const day = st.days.find(d => d.date === today);
  if (!day) return null;
  const c = computeDay(day, st, dayWeather(today));
  const now = romeNowMin();
  const live = c.items.filter(x => !x.done);
  const cur = live.find(x => now >= x.start && now < x.end);
  const next = live.find(x => x.start > now && x !== cur);
  return { today, c, now, cur, next };
}

function nowCardHtml(st) {
  const n = nowState(st);
  if (!n) return '';
  const { cur, next, now, c } = n;
  const hotel = hotelOf(st);
  const nm = ci => esc(itemTitle(ci).name);
  const lines = [];
  if (cur) lines.push(`<div class="now-line"><span class="now-tag">עכשיו</span><b>${itemTitle(cur).emoji} ${nm(cur)}</b><small>עד ${fromMin(cur.end)}</small></div>`);
  if (next) {
    const mins = next.start - now;
    const inTxt = mins < 60 ? `בעוד ${mins} דק׳` : `בעוד ${fmtDur(mins)}`;
    const leg = next.leg ? (next.leg.mode === 'walk' ? ` · 🚶 ${next.leg.min} דק׳` : ` · 🚕 כ-${next.leg.min} דק׳`) : '';
    const inAir = next.t === 'fixed' && (next.kind === 'flight' || next.kind === 'airport');
    const nav = next.loc && !inAir ? `<a class="btn btn-primary btn-xs" href="${gmapsDir(next.loc, null, next.leg?.mode === 'ride' ? 'transit' : 'walking')}" target="_blank" rel="noopener">${icon('nav')}ניווט</a>` : '';
    lines.push(`<div class="now-line"><span class="now-tag soft">הבא</span><b>${itemTitle(next).emoji} ${nm(next)}</b><small>${fromMin(next.start)} · ${inTxt}${leg}</small>${nav}</div>`);
  } else if (!cur && c.items.length && now >= c.end) {
    lines.push(`<div class="now-line"><span class="now-tag soft">סיימנו</span><b>זהו להיום 🎉</b>${hotel && n.today !== TRIP.dates[5] ? `<a class="btn btn-soft btn-xs" href="${gmapsDir(hotel)}" target="_blank" rel="noopener">${icon('nav')}למלון</a>` : ''}</div>`);
  }
  const wxLine = nowWeatherLine(n.today, now);
  if (wxLine) lines.push(wxLine);
  if (lines.length) lines.push('<a class="chip chip-sm now-near" href="#/near">📍 מה טוב סביבי עכשיו</a>');
  if (!lines.length) return '';
  return `<section class="card now-card" data-nowcard>${lines.join('')}</section>`;
}

// "🌧️ 19° · rain now, easing around 17:00" / "☔ rain from 15:00" / "dry for the next hours".
function nowWeatherLine(date, now) {
  const hr = Math.floor(now / 60);
  const cur = hourWeather(date, hr);
  if (!cur) return '';
  let status;
  if (wetness(cur) >= 2) {
    let h = hr + 1;
    while (h < 24 && wetness(hourWeather(date, h)) >= 2) h++;
    status = h < 24 ? `גשם עכשיו, צפוי להיחלש בסביבות ${String(h).padStart(2, '0')}:00` : 'גשם עכשיו ועד הלילה';
  } else {
    let h = hr + 1;
    while (h <= Math.min(23, hr + 4) && wetness(hourWeather(date, h)) < 2) h++;
    status = h <= Math.min(23, hr + 4) ? `☔ גשם צפוי בסביבות ${String(h).padStart(2, '0')}:00` : 'יבש בשעות הקרובות';
  }
  return `<div class="now-line now-wx"><span class="now-tag soft">${wxIcon(cur.code)} ${cur.t}°</span><small>${status}</small></div>`;
}

let nowTimer = null;
function startNowTimer(root) {
  clearInterval(nowTimer);
  nowTimer = setInterval(() => {
    if (!location.hash.startsWith('#/plan') && location.hash !== '' && location.hash !== '#/') { clearInterval(nowTimer); return; }
    const el = root.querySelector('[data-nowcard]');
    const html = nowCardHtml(store.state);
    if (el) el.outerHTML = html || '<span data-nowcard hidden></span>';
  }, 60 * 1000);
}

// ---------- the day's route in Google Maps ----------

// A search text Google Maps resolves well: the Latin name plus a clean street address.
function mapsQuery(e) {
  if (!e) return null;
  const HEB = /[֐-׿]/;
  const clean = s => (s || '').replace(/\([^)]*\)/g, '').replace(/\s+[·–]\s.*$/, '').replace(/\s*\+\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const latin = s => !!s && /[a-z]/i.test(s) && !HEB.test(s);
  const label = [e.name, e.orig].map(clean).find(latin);
  const addr = clean(e.address);
  const street = latin(addr) && !addr.includes(' / ') ? addr : null;
  if (label && street) return street.toLowerCase().startsWith(label.toLowerCase()) ? street : `${label}, ${street}`;
  if (label) return `${label}, Roma`;
  return e.lat != null ? `${e.lat},${e.lng}` : null;
}

export function dayRouteUrl(day, c, st) {
  const hotel = hotelOf(st);
  const stops = c.items.filter(ci => ci.e && ci.e.kind !== 'hotel' && ci.loc && !ci.noroute && !ci.done).map(ci => mapsQuery(ci.e)).filter(Boolean);
  if (!stops.length) return null;
  const home = hotel ? `${hotel.name}, ${hotel.address}` : null;
  const p = new URLSearchParams({ api: '1', travelmode: 'walking' });
  if (home) { p.set('origin', home); p.set('destination', home); }
  else { p.set('destination', stops.pop()); }
  if (stops.length) p.set('waypoints', stops.slice(0, 9).join('|'));
  return `https://www.google.com/maps/dir/?${p.toString()}`;
}

// ---------- the day's forecast by the hour ----------

function hourlyStrip(date) {
  const hs = wx.hours[date];
  if (!hs) return '';
  const cells = [];
  for (let h = 7; h <= 23; h++) {
    const x = hs[h];
    if (!x) continue;
    const rain = x.pop != null ? `${x.pop}%` : x.mm >= 0.1 ? `${x.mm.toFixed(1)}` : '';
    cells.push(`<div class="wxh ${wetness(x) >= 2 ? 'wet' : ''}"><small>${String(h).padStart(2, '0')}</small><span>${wxIcon(x.code)}</span><b>${x.t}°</b><small>${rain}</small></div>`);
  }
  if (!cells.length) return '';
  const at = wx.fetchedAt ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(wx.fetchedAt)) : '';
  return `<details class="wx-hours"><summary>התחזית לפי שעות</summary>
    <div class="wxh-row" dir="ltr">${cells.join('')}</div>
    <small class="muted">${wx.source ? `לפי ${esc(wx.source)}` : ''}${at ? ` · עודכנה ב-${at}` : ''}${wx.hours[date]?.some(x => x && x.pop != null) ? ' · אחוזים = סיכוי לגשם' : ' · מספרים = מ״מ גשם בשעה'}</small>
  </details>`;
}

// ---------- render ----------

export function renderPlan(root, param) {
  const st = store.state;
  const date = selectedDate(param);
  const day = st.days.find(d => d.date === date);
  const idx = dayIndex(date);
  const w = dayWeather(date);
  const c = computeDay(day, st, w);
  const hotel = hotelOf(st);
  const nowMin = romeToday() === date ? romeNowMin() : null;
  const first = c.items[0];
  const rainTxt = w ? (w.pop != null ? `${w.pop}% גשם` : w.mm >= 0.2 ? `גשם ~${Math.round(w.mm)} מ״מ` : 'בלי גשם') : '';
  const weatherLine = w
    ? `${wxIcon(w.code)} ${esc(wxText(w.code))} ${ltr(`${w.tmin}°–${w.tmax}°`)} · ${rainTxt}`
    : `${wxIcon(CLIMATE.code)} ממוצע לעונה ${ltr(`${CLIMATE.tmin}°–${CLIMATE.tmax}°`)}`;
  const spans = rainSpans(date);
  const rainLine = spans.length
    ? `<div class="wx-rain">☔ גשם צפוי ${spans.map(([a, b]) => ltr(`${String(a).padStart(2, '0')}:00–${String(b).padStart(2, '0')}:00`)).join(', ')}${w?.gust >= 40 ? ` · 💨 משבי רוח עד ${w.gust} קמ״ש` : ''}</div>`
    : (wx.hours[date] ? `<div class="wx-rain dry">🌤️ לא צפוי גשם בשעות היום${w?.gust >= 40 ? ` · 💨 משבי רוח עד ${w.gust} קמ״ש` : ''}</div>` : '');

  let prevLoc = idx === 0 ? TRIP.airport : hotel;
  const itemsHtml = c.items.map((ci, i) => {
    const html = itemHtml(ci, i, c.items, st, prevLoc, nowMin, c.wd);
    if (ci.loc) prevLoc = ci.loc;
    return html;
  }).join('');

  const showHotelLines = idx > 0 && idx < 5;
  const leaveLine = showHotelLines && first
    ? `<div class="leg leg-hotel">🏨 ${hotel ? `יציאה מ-${esc(hotel.name)} ב-${fromMin(c.leave)}` : `מתחילים ב-${fromMin(c.leave)}`}</div>` : '';
  const backLine = idx < 5 && c.back
    ? `<div class="leg leg-hotel">🏨 חזרה למלון בסביבות ${fromMin(c.end + c.back.min)} (${c.back.mode === 'walk' ? `${c.back.min} דק׳ הליכה` : `כ-${c.back.min} דק׳ במונית`})${hotel ? ` · <a href="${gmapsDir(hotel, c.items.filter(x => x.loc).pop()?.loc)}" target="_blank" rel="noopener">ניווט</a>` : ''}</div>` : '';
  const route = day.noroute ? null : dayRouteUrl(day, c, st);

  root.innerHTML = `
    ${nowCardHtml(st)}
    ${bookingAlert(st)}
    <nav class="daychips" role="tablist">${dayChips(date)}</nav>
    <section class="card day-head" style="--dc:var(--day${idx})">
      <div class="dh-top">
        <div>
          <div class="dh-date">יום ${WD_LONG[c.wd]} · ${dm(date)}</div>
          <h2 class="dh-title">${esc(day.title || 'יום חופשי')}</h2>
        </div>
        <button class="icon-btn" data-act="daymenu" aria-label="אפשרויות ליום">${icon('more')}</button>
      </div>
      <div class="dh-meta">
        <span>${weatherLine}</span>
        <span>🌅 שקיעה ${c.sun.sunset}</span>
        ${first ? `<span>${icon('clock', 'ic-xs')} ${ltr(`${fromMin(first.start)}–${fromMin(c.end)}`)}</span>` : ''}
        ${c.walkKm > 0.3 ? `<span>🚶 כ-${c.walkKm.toFixed(1)} ק״מ</span>` : ''}
      </div>
      ${rainLine}
      ${hourlyStrip(date)}
      ${warnHtml(c.warns)}
      <div class="dh-actions">
        ${route ? `<a class="btn btn-primary btn-sm" href="${esc(route)}" target="_blank" rel="noopener">${icon('map')}המסלול ב-Google Maps</a>` : ''}
        <button class="btn btn-soft btn-sm" data-act="onmap">${icon('pin')}במפה</button>
      </div>
    </section>
    ${leaveLine}
    <ol class="timeline" id="tl">${itemsHtml || '<li class="empty">היום ריק. אפשר להוסיף פעילות או לשחזר את הלו״ז המקורי.</li>'}</ol>
    ${backLine}
    <div class="day-actions">
      <button class="btn btn-primary" data-act="add">${icon('plus')}הוספה ליום</button>
    </div>
  `;

  bind(root, day, c);
  startNowTimer(root);
  const nowEl = root.querySelector('.tl-item.now');
  if (nowEl) nowEl.scrollIntoView({ block: 'center' });
}

function patchItem(date, u, fn) {
  update(s => {
    const d = s.days.find(x => x.date === date);
    const t = d?.items.find(x => x.u === u);
    if (t) fn(t, d);
  });
}

function bind(root, day, c) {
  const date = day.date;
  root.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', ev => {
    if (ev.target.closest('a,button')) return;
    openDetail(el.dataset.open);
  }));
  root.querySelectorAll('[data-alt]').forEach(el => el.addEventListener('click', ev => {
    ev.stopPropagation();
    const u = el.closest('[data-u]').dataset.u;
    const id = el.dataset.alt;
    const ci = c.items.find(x => x.u === u);
    if (ci?.id === id) { openDetail(id); return; }
    patchItem(date, u, t => { t.id = id; });
    toast(`נבחר: ${get(id)?.name || ''}`);
  }));
  root.querySelectorAll('[data-done]').forEach(el => el.addEventListener('click', () => {
    const u = el.dataset.done;
    patchItem(date, u, t => { if (t.done) delete t.done; else t.done = true; });
  }));
  root.querySelectorAll('[data-setfood]').forEach(el => el.addEventListener('click', ev => {
    ev.stopPropagation();
    const u = el.closest('[data-u]').dataset.u;
    setFood(date, u, el.dataset.setfood);
  }));
  root.querySelectorAll('[data-pickfood]').forEach(el => el.addEventListener('click', ev => {
    if (ev.target.closest('button')) return;
    openFoodPicker(date, el.dataset.pickfood);
  }));
  root.querySelectorAll('[data-menu]').forEach(el => el.addEventListener('click', () => openItemMenu(date, el.dataset.menu)));
  root.querySelectorAll('[data-book]').forEach(el => el.addEventListener('click', ev => {
    ev.stopPropagation();
    openBookings();
  }));
  root.querySelector('[data-act="add"]')?.addEventListener('click', () => openAddSheet(date));
  root.querySelector('[data-act="bookings"]')?.addEventListener('click', openBookings);
  root.querySelector('[data-act="daymenu"]')?.addEventListener('click', () => openDayMenu(date));
  root.querySelector('[data-act="onmap"]')?.addEventListener('click', () => { focusMapDay(date); location.hash = '#/map'; });
  root.querySelectorAll('[data-indoor]').forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation();
    openIndoorAlternatives(date, b.dataset.indoor);
  }));

  const tl = root.querySelector('#tl');
  if (tl && window.Sortable) {
    window.Sortable.create(tl, {
      handle: '.grip',
      draggable: '.tl-item',
      animation: 160,
      ghostClass: 'drag-ghost',
      onMove: evt => !evt.related.classList.contains('fixed'),
      onEnd: evt => {
        const order = [...tl.querySelectorAll('.tl-item')].map(li => li.dataset.u);
        const movedU = evt.item?.dataset.u;
        let cleared = null;
        update(s => {
          const d = s.days.find(x => x.date === date);
          d.items.sort((a, b) => order.indexOf(a.u) - order.indexOf(b.u));
          // A stop with a fixed time that was dragged out of time order loses its time,
          // and then simply follows the stop before it.
          const k = d.items.findIndex(x => x.u === movedU);
          const moved = d.items[k];
          const p = toMin(moved?.pin);
          if (p == null) return;
          const before = d.items.slice(0, k).reverse().find(x => x.pin);
          const after = d.items.slice(k + 1).find(x => x.pin);
          if ((before && toMin(before.pin) > p) || (after && toMin(after.pin) < p)) {
            delete moved.pin;
            cleared = moved;
          }
        });
        if (cleared) toast('השעה הקבועה בוטלה, והפריט ממשיך אחרי התחנה שלפניו. אפשר לקבוע שעה חדשה בתפריט ⋮', { ms: 6000 });
      },
    });
  }
}

function setFood(date, u, foodId) {
  update(s => {
    const d = s.days.find(x => x.date === date);
    const i = d.items.findIndex(x => x.u === u);
    if (i < 0) return;
    const it = d.items[i];
    d.items[i] = { u, t: 'food', id: foodId, meal: it.meal || 'lunch', ...(it.pin ? { pin: it.pin } : {}), ...(it.note ? { note: it.note } : {}) };
  });
}

export function openFoodPicker(date, u) {
  const st = store.state;
  const day = st.days.find(d => d.date === date);
  const c = computeDay(day, st, dayWeather(date));
  const idx = c.items.findIndex(x => x.u === u);
  const ci = c.items[idx];
  if (!ci) return;
  const near = nearestLoc(c.items, idx) || TRIP.center;
  const s = openSheet({
    title: `${MEAL_LABEL[ci.meal] || 'ארוחה'} · ${fromMin(ci.start)}`,
    body: `<p class="muted small">ממוין לפי המרחק מהתחנה הקודמת, ורק מקומות שפתוחים בשעה הזו.</p><div class="picker-list"></div>`,
    onMount(body) {
      const list = rankFood({ meal: ci.meal === 'snack' ? null : ci.meal, near, wd: c.wd, time: ci.start, diet: 'any' }).slice(0, 30);
      body.querySelector('.picker-list').innerHTML = list.map(r => `
        <button class="pick-row" data-id="${r.f.id}">
          <span class="pick-emoji">${tile(r.f, 'tile-sm')}</span>
          <span class="pick-main"><b>${esc(r.f.name)}</b><small>${esc(FOOD_TYPES[r.f.type]?.he || '')} · ${priceLevel(r.f.price)} · ${legOf(near, r.f)?.min ?? '?'} דק׳ ${legOf(near, r.f)?.mode === 'walk' ? 'הליכה' : 'נסיעה'}</small></span>
        </button>`).join('') || '<div class="empty">אין מקומות פתוחים שמתאימים.</div>';
      body.querySelectorAll('.pick-row').forEach(b => b.addEventListener('click', () => {
        setFood(date, u, b.dataset.id);
        s.close();
      }));
    },
  });
}

// ---------- item menu: time, duration, note, alternatives, move, remove ----------

function openItemMenu(date, u) {
  const st = store.state;
  const day = st.days.find(d => d.date === date);
  const it = day.items.find(x => x.u === u);
  if (!it) return;
  const e = it.id ? get(it.id) : null;
  const c = computeDay(day, st, dayWeather(date));
  const ci = c.items.find(x => x.u === u);
  const prev = c.items.slice(0, c.items.indexOf(ci)).reverse().find(x => x.loc);
  const fixed = it.t === 'fixed';
  const otherDays = TRIP.dates.filter(d => d !== date);
  const durs = [10, 15, 20, 30, 45, 60, 75, 90, 105, 120, 150, 180, 240];
  const curDur = ci?.dur || 60;
  const title = ci ? itemTitle(ci).name : (e?.name || it.title || 'פריט');
  const alts = it.alts?.length ? it.alts : (e && (it.t === 'food' || it.t === 'place') ? [it.id] : []);
  const bookable = e && needsBooking(e);

  openSheet({
    title,
    cls: 'sheet-small',
    body: `
      <div class="menu-list">
        ${e && e.kind !== 'hotel' ? `<button data-a="detail">${icon('info')}פרטים מלאים</button>` : ''}
        ${ci?.loc ? `<a href="${gmapsDir(ci.loc, prev?.loc)}" target="_blank" rel="noopener">${icon('nav')}ניווט לכאן</a>` : ''}
        <button data-a="done">${icon('check')}${it.done ? 'ביטול הסימון "עשינו"' : 'סימון שעשינו ✓'}</button>
        ${bookable ? `<button data-a="booked">${icon('ticket')}${st.booked[e.id] ? 'סימון שעוד לא הזמנו' : 'סימון שהזמנו ✓'}</button>` : ''}
      </div>
      <div class="menu-grid">
        <label class="field"><span>שעה</span>
          <input type="time" data-f="pin" value="${esc(it.pin || '')}" step="300"></label>
        <label class="field"><span>משך</span>
          <select data-f="dur">
            ${it.fit ? `<option value="fit" selected>גמיש, עד התחנה הבאה (${fmtDur(curDur)})</option>` : '<option value="fit">גמיש, עד התחנה הבאה</option>'}
            ${durs.map(d => `<option value="${d}" ${!it.fit && d === curDur ? 'selected' : ''}>${fmtDur(d)}</option>`).join('')}
            ${!it.fit && !durs.includes(curDur) ? `<option value="${curDur}" selected>${fmtDur(curDur)}</option>` : ''}
          </select></label>
      </div>
      ${it.t === 'custom' || fixed ? `<label class="field"><span>שם</span><input type="text" data-f="title" value="${esc(it.title || '')}"></label>` : ''}
      <label class="field"><span>הערה</span><input type="text" data-f="note" value="${esc(it.note || '')}" placeholder="למשל: כרטיסים במייל"></label>
      ${alts.length ? `
        <h3 class="h3">אופציות למשבצת הזו</h3>
        <div class="alt-edit">${alts.map(id => {
          const a = get(id);
          return a ? `<div class="alt-edit-row">
            <button class="alt-chip ${id === it.id ? 'on' : ''}" data-pick="${esc(id)}">${id === it.id ? icon('check', 'ic-xs') : ''}${emojiOf(a)} ${esc(a.name)}</button>
            ${alts.length > 1 ? `<button class="icon-btn" data-unalt="${esc(id)}" aria-label="הסרת האופציה">${icon('x')}</button>` : ''}
          </div>` : '';
        }).join('')}</div>
        <button class="btn btn-soft btn-sm" data-a="addalt">${icon('plus')}הוספת אופציה</button>` : ''}
      <div class="row-btns">
        ${fixed ? '' : `<button class="btn btn-soft btn-sm" data-a="up">${icon('up')}למעלה</button>
        <button class="btn btn-soft btn-sm" data-a="down">${icon('down')}למטה</button>`}
        ${it.pin ? `<button class="btn btn-soft btn-sm" data-a="unpin">בלי שעה קבועה</button>` : ''}
      </div>
      ${fixed ? '' : `<h3 class="h3">העברה ליום אחר</h3>
      <div class="daybtns">${otherDays.map(d => `<button class="daybtn" data-move="${d}" ${e && e.kind !== 'hotel' && closedOn(e, weekdayOf(d)) ? 'disabled' : ''}><b>${dayLabel(d)}</b><small>${e && e.kind !== 'hotel' && closedOn(e, weekdayOf(d)) ? 'סגור' : '&nbsp;'}</small></button>`).join('')}</div>`}
      <button class="btn btn-danger-soft btn-block" data-a="remove">${icon('trash')}הסרה מהיום</button>
    `,
    onMount(body, close) {
      const patch = fn => patchItem(date, u, fn);
      body.querySelector('[data-a="detail"]')?.addEventListener('click', () => { close(); setTimeout(() => openDetail(e.id), 230); });
      body.querySelector('[data-a="done"]')?.addEventListener('click', () => { patch(t => { if (t.done) delete t.done; else t.done = true; }); close(); });
      body.querySelector('[data-a="booked"]')?.addEventListener('click', () => { toggleBooked(e.id); close(); });
      body.querySelector('[data-f="pin"]')?.addEventListener('change', ev => patch((t, d) => {
        delete t.soft;
        if (ev.target.value) t.pin = ev.target.value; else delete t.pin;
        sortByPins(d);
      }));
      body.querySelector('[data-f="dur"]')?.addEventListener('change', ev => patch(t => {
        if (ev.target.value === 'fit') { t.fit = true; delete t.dur; } else { delete t.fit; t.dur = +ev.target.value; }
      }));
      body.querySelector('[data-f="note"]')?.addEventListener('change', ev => patch(t => { t.note = ev.target.value.trim() || undefined; }));
      body.querySelector('[data-f="title"]')?.addEventListener('change', ev => patch(t => { if (ev.target.value.trim()) t.title = ev.target.value.trim(); }));
      body.querySelector('[data-a="unpin"]')?.addEventListener('click', () => { patch(t => { delete t.pin; delete t.soft; }); close(); });
      body.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
        patch(t => { t.id = b.dataset.pick; if (!t.alts?.length) t.alts = [b.dataset.pick]; });
        close();
      }));
      body.querySelectorAll('[data-unalt]').forEach(b => b.addEventListener('click', () => {
        patch(t => {
          t.alts = (t.alts || []).filter(x => x !== b.dataset.unalt);
          if (t.id === b.dataset.unalt) t.id = t.alts[0];
          if (t.alts.length < 2) delete t.alts;
        });
        close();
      }));
      body.querySelector('[data-a="addalt"]')?.addEventListener('click', () => { close(); setTimeout(() => openAddSheet(date, { altFor: u }), 230); });
      const move = dir => patch((t, d) => {
        const k = d.items.indexOf(t), j = k + dir;
        if (j < 0 || j >= d.items.length || d.items[j].t === 'fixed') return;
        [d.items[k], d.items[j]] = [d.items[j], d.items[k]];
        // Swapping two timed stops swaps their times, so the day stays in order.
        if (t.pin && d.items[k].pin) [t.pin, d.items[k].pin] = [d.items[k].pin, t.pin];
      });
      body.querySelector('[data-a="up"]')?.addEventListener('click', () => move(-1));
      body.querySelector('[data-a="down"]')?.addEventListener('click', () => move(1));
      body.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', () => {
        update(s2 => {
          const from = s2.days.find(x => x.date === date);
          const to = s2.days.find(x => x.date === b.dataset.move);
          const k = from.items.findIndex(x => x.u === u);
          if (k < 0) return;
          const [moved] = from.items.splice(k, 1);
          if (moved.pin) { to.items.push(moved); sortByPins(to); } else insertItem(to, moved);
        });
        close();
        toast(`הועבר ל${dayLabel(b.dataset.move)}`, { action: 'לשם', onAction: () => { location.hash = `#/plan/${b.dataset.move}`; } });
      }));
      body.querySelector('[data-a="remove"]')?.addEventListener('click', () => {
        snapshot();
        update(s2 => {
          const d = s2.days.find(x => x.date === date);
          d.items = d.items.filter(x => x.u !== u);
        });
        close();
        toast('הוסר מהיום', { action: 'ביטול', onAction: undo });
      });
    },
  });
}

// ---------- covered alternatives when the weather turns ----------

function openIndoorAlternatives(date, u) {
  const st = store.state;
  const day = st.days.find(d => d.date === date);
  const c = computeDay(day, st, dayWeather(date));
  const ci = c.items.find(x => x.u === u);
  if (!ci || !ci.loc) return;
  const used = new Set(day.items.flatMap(i => [i.id, ...(i.alts || [])]));
  const rows = DB.places
    .filter(e => e.indoor === true && e.lat != null && !used.has(e.id) && e.cat !== 'experience' && e.cat !== 'event')
    .map(e => ({ e, km: distKm(ci.loc, e), chk: checkOpen(e, c.wd, ci.start, ci.start + Math.min(ci.dur, 60)) }))
    .filter(r => r.km <= 2 && r.chk.ok)
    .sort((a, b) => a.km - b.km)
    .slice(0, 10);
  const s = openSheet({
    title: `חלופה מקורה ל${itemTitle(ci).name}`,
    body: `<p class="muted small">מקומות מקורים עד 2 ק״מ משם, שפתוחים ב-${fromMin(ci.start)}. בחירה מחליפה את הפעילות, והמקורית נשארת כאופציה: לחיצה עליה מחזירה אותה.</p>
      <div class="picker-list">${rows.length ? rows.map(({ e, km }) => `
        <button class="pick-row" data-id="${e.id}">
          <span class="pick-emoji">${tile(e, 'tile-sm')}</span>
          <span class="pick-main"><b>${esc(e.name)}</b><small>${fmtKm(km)} · ${e.dur ? fmtDur(e.dur) : ''}${e.price ? ` · ${bidi(e.price)}` : ''}</small></span>
          <span class="pick-add">${icon('swap')}</span>
        </button>`).join('') : '<div class="empty">לא מצאנו מקום מקורה פתוח בסביבה בשעה הזו.</div>'}</div>`,
    onMount(body) {
      body.querySelectorAll('.pick-row').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.id;
        patchItem(date, u, t => {
          const alts = t.alts?.length ? t.alts : [t.id];
          if (!alts.includes(id)) alts.push(id);
          t.alts = alts;
          t.id = id;
        });
        s.close();
        toast(`הוחלף ב${get(id)?.name ? `־${get(id).name}` : ''}. לחיצה על האופציה המקורית מחזירה אותה`, { ms: 5000 });
      }));
    },
  });
}

// ---------- day menu ----------

function openDayMenu(date) {
  const day = store.state.days.find(d => d.date === date);
  openSheet({
    title: dayLabel(date),
    cls: 'sheet-small',
    body: `
      <label class="field"><span>שם היום</span><input type="text" data-title value="${esc(day.title || '')}"></label>
      <div class="menu-list">
        <button data-a="restore">${icon('refresh')}שחזור היום ללו״ז המקורי</button>
        <button data-a="undone">${icon('check')}ניקוי סימוני "עשינו" ביום הזה</button>
      </div>`,
    onMount(body, close) {
      body.querySelector('[data-title]').addEventListener('change', ev => update(s => {
        const d = s.days.find(x => x.date === date);
        if (ev.target.value.trim()) d.title = ev.target.value.trim();
      }));
      body.querySelector('[data-a="undone"]').addEventListener('click', () => {
        update(s => { s.days.find(x => x.date === date).items.forEach(it => { delete it.done; }); });
        close();
      });
      body.querySelector('[data-a="restore"]').addEventListener('click', async () => {
        const ok = await confirmSheet({ title: 'לשחזר את היום?', text: 'היום יחזור ללו״ז הסופי המקורי, והשינויים שעשיתם בו יימחקו. אפשר לבטל מיד אחרי.', ok: 'שחזור' });
        if (!ok) return;
        close();
        restoreDays([date]);
      });
    },
  });
}

export function restoreDays(dates = null) {
  snapshot();
  const fresh = scheduleDays(dates);
  update(s => {
    for (const d of fresh) {
      const i = s.days.findIndex(x => x.date === d.date);
      if (i >= 0) s.days[i] = d; else s.days.push(d);
    }
    s.days.sort((a, b) => a.date.localeCompare(b.date));
  });
  toast(dates?.length === 1 ? 'היום שוחזר' : 'הלו״ז המקורי שוחזר', { action: 'ביטול', onAction: undo, ms: 6000 });
}

// ---------- add to day (or as an alternative) ----------

function catalog() {
  return [
    ...DB.places.map(e => ({ e, group: e.cat === 'experience' || e.cat === 'event' ? 'exp' : e.cat === 'shopping' ? 'shop' : 'place' })),
    ...DB.food.map(e => ({ e, group: 'food' })),
  ];
}

function openAddSheet(date, { altFor = null } = {}) {
  const st = store.state;
  const day = st.days.find(d => d.date === date);
  const wd = weekdayOf(date);
  const hotel = hotelOf(st);
  const altItem = altFor ? day.items.find(x => x.u === altFor) : null;
  const pts = day.items.map(i => locOf(i, i.id ? get(i.id) : null, hotel)).filter(Boolean);
  const center = (altItem && get(altItem.id)) || centroid(pts) || hotel || TRIP.center;
  const inDay = new Set(day.items.flatMap(i => [i.id, ...(i.alts || [])]).filter(Boolean));
  let group = altItem ? (get(altItem.id)?.kind === 'food' ? 'food' : 'place') : 'ours', q = '';
  const groups = [['ours', '📍 שלנו'], ['place', 'אטרקציות'], ['food', 'אוכל'], ['exp', 'חוויות'], ['shop', 'שופינג'], ...(altItem ? [] : [['custom', 'אישי']])];

  const listHtml = () => {
    if (group === 'custom') {
      return `<form class="custom-form">
        <label class="field"><span>מה עושים?</span><input name="title" required placeholder="למשל: מנוחה במלון / קניות מתנות"></label>
        <div class="menu-grid">
          <label class="field"><span>משך</span><select name="dur">${[30, 45, 60, 90, 120, 180].map(d => `<option value="${d}" ${d === 60 ? 'selected' : ''}>${fmtDur(d)}</option>`).join('')}</select></label>
          <label class="field"><span>שעה (לא חובה)</span><input type="time" name="pin" step="300"></label>
        </div>
        <label class="field"><span>הערה</span><input name="note" placeholder="לא חובה"></label>
        <button class="btn btn-primary btn-block">${icon('plus')}הוספה</button>
      </form>`;
    }
    const ql = q.trim().toLowerCase();
    const rows = catalog()
      .filter(x => (group === 'ours' ? x.e.ours : x.group === group))
      .filter(x => !ql || `${x.e.name} ${x.e.orig || ''} ${x.e.desc || ''}`.toLowerCase().includes(ql))
      .map(x => ({ ...x, km: distKm(center, x.e) ?? 99, closed: closedOn(x.e, wd) }))
      .sort((a, b) => (a.closed - b.closed) || (a.km - b.km))
      .slice(0, 80);
    if (!rows.length) return '<div class="empty">לא נמצא. נסו חיפוש אחר.</div>';
    return rows.map(({ e, km, closed }) => `
      <button class="pick-row ${closed ? 'is-closed' : ''}" data-id="${e.id}">
        <span class="pick-emoji">${tile(e, 'tile-sm')}</span>
        <span class="pick-main"><b>${esc(e.name)}${inDay.has(e.id) ? ' ✓' : ''}</b>
          <small>${closed ? `סגור ביום ${WD_LONG[wd]}` : km < 50 ? `${fmtKm(km)} ${altItem ? 'מהאופציה הנוכחית' : 'מהיום'}` : ''}${e.wish ? ' · עוד לא שובץ' : ''}${e.kind === 'food' ? ` · ${priceLevel(e.price)}` : ''}</small></span>
        <span class="pick-add">${icon('plus')}</span>
      </button>`).join('');
  };

  openSheet({
    title: altItem ? 'הוספת אופציה למשבצת' : `הוספה ל${dayLabel(date)}`,
    cls: 'sheet-tall',
    body: `${altItem ? '' : `<label class="field inline"><span>באיזו שעה?</span><input type="time" data-pin step="300"><small class="muted">לא חובה</small></label>`}
      <div class="search"><span>${icon('search')}</span><input type="search" placeholder="חיפוש…" data-q></div>
      <div class="chips-scroll" data-groups>${groups.map(([g, l]) => `<button class="chip ${g === group ? 'on' : ''}" data-g="${g}">${l}</button>`).join('')}</div>
      <div class="picker-list" data-list></div>`,
    onMount(body, close) {
      const list = body.querySelector('[data-list]');
      const pinEl = body.querySelector('[data-pin]');
      const draw = () => {
        list.innerHTML = listHtml();
        list.querySelectorAll('.pick-row').forEach(b => b.addEventListener('click', () => {
          const e = get(b.dataset.id);
          if (altItem) {
            patchItem(date, altFor, t => {
              const alts = t.alts?.length ? t.alts : [t.id];
              if (!alts.includes(e.id)) alts.push(e.id);
              t.alts = alts;
            });
            close();
            toast(`${e.name} נוסף כאופציה`);
            return;
          }
          const pin = pinEl?.value || '';
          update(s2 => {
            const d = s2.days.find(x => x.date === date);
            const item = { u: uid(), t: e.kind === 'food' ? 'food' : 'place', id: e.id };
            if (e.kind === 'food') item.meal = (e.meals || []).includes('dinner') && toMin(pin) >= toMin('18:00') ? 'dinner' : (e.meals || []).includes('lunch') && toMin(pin) >= toMin('12:00') && toMin(pin) < toMin('16:00') ? 'lunch' : 'snack';
            if (pin) { item.pin = pin; d.items.push(item); sortByPins(d); } else insertItem(d, item);
          });
          inDay.add(e.id);
          b.querySelector('b').textContent = `${e.name} ✓`;
          toast(`${e.name} נוסף`);
        }));
        list.querySelector('.custom-form')?.addEventListener('submit', ev => {
          ev.preventDefault();
          const f = new FormData(ev.target);
          update(s2 => {
            const d = s2.days.find(x => x.date === date);
            const item = { u: uid(), t: 'custom', title: f.get('title').trim(), dur: +f.get('dur') };
            if (f.get('note')) item.note = f.get('note').trim();
            const pin = f.get('pin') || pinEl?.value || '';
            if (pin) { item.pin = pin; d.items.push(item); sortByPins(d); } else insertItem(d, item);
          });
          close();
        });
      };
      body.querySelector('[data-q]').addEventListener('input', ev => { q = ev.target.value; draw(); });
      body.querySelectorAll('[data-g]').forEach(b => b.addEventListener('click', () => {
        group = b.dataset.g;
        body.querySelectorAll('[data-g]').forEach(x => x.classList.toggle('on', x === b));
        draw();
      }));
      draw();
    },
  });
}
