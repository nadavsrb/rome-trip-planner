// The day-by-day schedule: day chips, timeline with walking legs, warnings,
// drag-to-reorder, meal suggestions and per-item actions.
import { DB, get } from '../data.js';
import { store, update, snapshot, undo } from '../store.js';
import { esc, ltr, bidi, icon, fromMin, fmtDur, fmtKm, WD_LONG, WD_SHORT, weekdayOf, dm, romeToday, romeNowMin, uid, priceLevel, FOOD_TYPES } from '../util.js';
import {
  TRIP, PLANNABLE_DAYS, computeDay, rankFood, themeTitle, themeOptions, rebuildDay, insertItem,
  MEAL_LABEL, paceOf, closedOn, locOf, nearestLoc,
} from '../planner.js';
import { gmapsDir, distKm, leg as legOf, centroid } from '../geo.js';
import { dayWeather, wxIcon, wxText, CLIMATE } from '../weather.js';
import { openSheet, toast } from '../ui.js';
import { openDetail, emojiOf, foodBadges, dayLabel, toggleBooked } from './common.js';
import { openPlannerSheet } from './settings.js';

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

function mealSuggestions(ci, items, idx, st) {
  const near = nearLoc(items, idx) || TRIP.center;
  const used = new Set(st.days.flatMap(d => d.items.filter(i => i.t === 'food').map(i => i.id)));
  const top = rankFood({ meal: ci.meal, near, wd: weekdayOf(current), time: ci.start, diet: st.settings.diet, exclude: used }).slice(0, 3);
  if (!top.length) return '<div class="muted small">לא נמצאה הצעה מתאימה — לחצו להחלפה ידנית</div>';
  return `<div class="suggest">${top.map(r => `<button class="chip chip-sm" data-setfood="${r.f.id}">${FOOD_TYPES[r.f.type]?.emoji || '🍽️'} ${esc(r.f.name)}${r.f.kosher ? ' ✡' : ''}</button>`).join('')}</div>`;
}

const nearLoc = nearestLoc;

function itemTitle(ci) {
  const e = ci.e;
  if (ci.t === 'fixed') return { emoji: { flight: '✈️', airport: '🛂', transfer: '🚕', hotel: '🏨' }[ci.kind] || '📌', name: ci.title };
  if (ci.t === 'custom') return { emoji: '📌', name: ci.title || 'פריט אישי' };
  if (ci.t === 'meal') return { emoji: '🍽️', name: `${MEAL_LABEL[ci.meal] || 'ארוחה'} — בחרו מקום` };
  if (!e) return { emoji: '❔', name: 'פריט שנמחק מהמאגר' };
  return { emoji: emojiOf(e), name: e.name };
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
  if (ci.pin && ci.t !== 'fixed') bits.push(ci.soft ? '🌅 מתוזמן לשקיעה' : `${icon('clock', 'ic-xs')} שעה קבועה`);
  if (ci.fav) bits.push('♥ מהמועדפים');
  if (ci.note) bits.push(esc(ci.note));
  return bits.filter(Boolean).join(' · ');
}

function daytripBlock(ci) {
  const t = ci.e;
  if (!t) return '';
  return `<ol class="mini-tl">${(t.plan || []).map(p => `<li><b>${esc(p.t)}</b><span>${esc(p.x)}</span></li>`).join('')}</ol>`;
}

function itemHtml(ci, idx, items, st, prevLoc, nowMin) {
  const { emoji, name } = itemTitle(ci);
  const fixed = ci.t === 'fixed';
  const isNow = nowMin != null && nowMin >= ci.start && nowMin < ci.end;
  const gap = ci.gap >= 20 ? `<div class="gap">⏳ ${fmtDur(ci.gap)} פנויות${ci.meal === 'dinner' && ci.gap >= 60 ? ' — זמן לאפריטיבו או מנוחה במלון' : ''}</div>` : '';
  const openAttr = ci.e ? `data-open="${esc(ci.e.id)}"` : (ci.t === 'meal' ? `data-pickfood="${ci.u}"` : '');
  return `<li class="tl-item ${fixed ? 'fixed' : ''} t-${ci.t} ${isNow ? 'now' : ''}" data-u="${ci.u}">
    ${legHtml(ci, prevLoc)}${gap}
    <div class="tl-card">
      <div class="tl-time"><b>${fromMin(ci.start)}</b>${ci.end > ci.start ? `<small>${fromMin(ci.end)}</small>` : ''}</div>
      <div class="tl-main" ${openAttr}>
        <div class="tl-title"><span class="tl-emoji">${emoji}</span>${esc(name)}${isNow ? ' <span class="badge badge-accent">עכשיו</span>' : ''}</div>
        <div class="tl-sub">${itemSub(ci)}</div>
        ${ci.t === 'food' && ci.e ? `<div class="badges">${foodBadges(ci.e)}</div>` : ''}
        ${ci.t === 'daytrip' ? daytripBlock(ci) : ''}
        ${warnHtml(ci.warns)}
        ${ci.hints.map(h => `<div class="hint">${esc(h)}</div>`).join('')}
        ${ci.t === 'meal' ? mealSuggestions(ci, items, idx, st) : ''}
      </div>
      <div class="tl-ctrl">
        ${fixed ? '' : `<button class="grip" aria-label="גרירה לשינוי סדר">${icon('grip')}</button>`}
        <button class="icon-btn" data-menu="${ci.u}" aria-label="פעולות">${icon('more')}</button>
      </div>
    </div>
  </li>`;
}

function bookingAlert(st) {
  const need = new Map();
  for (const d of st.days) for (const it of d.items) {
    const e = it.id && get(it.id);
    if (e && e.booking === 'required' && !st.booked[e.id]) need.set(e.id, e);
  }
  if (!need.size) return '';
  const names = [...need.values()].slice(0, 4).map(e => e.name).join(', ');
  return `<button class="alert-card" data-act="bookings">🎟️ <span><b>${need.size} כרטיסים עדיין לא הוזמנו</b><small>${esc(names)}${need.size > 4 ? '…' : ''}</small></span>${icon('chevL')}</button>`;
}

function daytripPrompt(st) {
  const s = st.settings;
  if (!s.interests.daytrip || s.dayTrip?.id || s.dismissed.daytrip) return '';
  if (st.days.some(d => d.theme?.startsWith('daytrip:'))) return '';
  const trips = [...DB.daytrips].sort((a, b) => (a.tier || 2) - (b.tier || 2)).slice(0, 5);
  return `<div class="card prompt">
    <div class="prompt-head"><b>🚆 בחרתם גם טיול יום — לאן?</b><button class="icon-btn" data-act="dismiss-daytrip" aria-label="לא עכשיו">${icon('x')}</button></div>
    <div class="chips-scroll">${trips.map(t => `<button class="chip" data-open="${t.id}">${esc(t.name)}</button>`).join('')}</div>
    <small class="muted">לחצו על יעד כדי לראות פרטים ולבחור יום.</small>
  </div>`;
}

export function renderPlan(root, param) {
  const st = store.state;
  const date = selectedDate(param);
  const day = st.days.find(d => d.date === date);
  const idx = dayIndex(date);
  const w = dayWeather(date);
  const c = computeDay(day, st, w);
  const pace = paceOf(st);
  const hotel = st.settings.hotelId ? get(st.settings.hotelId) : null;
  const nowMin = romeToday() === date ? romeNowMin() : null;
  const first = c.items[0];
  const weatherLine = w
    ? `${wxIcon(w.code)} ${esc(wxText(w.code))} ${ltr(`${w.tmin}°–${w.tmax}°`)} · ${w.pop ?? '–'}% גשם`
    : `${wxIcon(CLIMATE.code)} ממוצע לעונה ${ltr(`${CLIMATE.tmin}°–${CLIMATE.tmax}°`)} (התחזית תתעדכן קרוב לטיסה)`;

  let prevLoc = idx === 0 ? TRIP.airport : hotel;
  const itemsHtml = c.items.map((ci, i) => {
    const html = itemHtml(ci, i, c.items, st, prevLoc, nowMin);
    if (ci.loc) prevLoc = ci.loc;
    return html;
  }).join('');

  const showHotelLines = idx > 0 && idx < 5;
  const leaveLine = showHotelLines && first
    ? `<div class="leg leg-hotel">🏨 ${hotel ? `יציאה מהמלון ב-${fromMin(c.leave)}` : `מתחילים ב-${fromMin(c.leave)} · <a href="#/hotels">בחרו מלון</a> כדי לחשב זמני הגעה`}</div>` : '';
  const backLine = showHotelLines && c.back
    ? `<div class="leg leg-hotel">🏨 חזרה למלון בסביבות ${fromMin(c.end + c.back.min)} (${c.back.mode === 'walk' ? `${c.back.min} דק׳ הליכה` : `כ-${c.back.min} דק׳ במונית`})</div>` : '';

  root.innerHTML = `
    ${daytripPrompt(st)}
    ${bookingAlert(st)}
    <nav class="daychips" role="tablist">${dayChips(date)}</nav>
    <section class="card day-head" style="--dc:var(--day${idx})">
      <div class="dh-top">
        <div>
          <div class="dh-date">יום ${WD_LONG[c.wd]} · ${dm(date)}</div>
          <h2 class="dh-title">${esc(day.title || themeTitle(day.theme))}</h2>
        </div>
        ${idx > 0 && idx < 5 ? `<button class="btn btn-soft btn-sm" data-act="theme">${icon('swap')}נושא היום</button>` : ''}
      </div>
      <div class="dh-meta">
        <span>${weatherLine}</span>
        <span>🌅 שקיעה ${c.sun.sunset}</span>
        ${first ? `<span>${icon('clock', 'ic-xs')} ${ltr(`${fromMin(first.start)}–${fromMin(c.end)}`)}</span>` : ''}
        ${c.walkKm > 0.3 ? `<span>🚶 כ-${c.walkKm.toFixed(1)} ק״מ</span>` : ''}
        <span class="pace-pill" data-act="planner">קצב: ${esc(pace.label)}</span>
      </div>
      ${warnHtml(c.warns)}
    </section>
    ${leaveLine}
    <ol class="timeline" id="tl">${itemsHtml || '<li class="empty">היום ריק — הוסיפו פעילות או בחרו נושא ליום.</li>'}</ol>
    ${backLine}
    ${idx < 5 ? `<div class="day-actions">
      <button class="btn btn-primary" data-act="add">${icon('plus')}הוספה ליום</button>
      <button class="btn btn-soft" data-act="planner">${icon('sparkles')}בניית לו״ז מוצע</button>
    </div>` : ''}
  `;

  bind(root, day, c);
  const nowEl = root.querySelector('.tl-item.now');
  if (nowEl) nowEl.scrollIntoView({ block: 'center' });
}

function bind(root, day, c) {
  root.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', ev => {
    if (ev.target.closest('a,button[data-setfood]')) return;
    openDetail(el.dataset.open);
  }));
  root.querySelectorAll('[data-setfood]').forEach(el => el.addEventListener('click', ev => {
    ev.stopPropagation();
    const u = el.closest('[data-u]').dataset.u;
    setFood(day.date, u, el.dataset.setfood);
  }));
  root.querySelectorAll('[data-pickfood]').forEach(el => el.addEventListener('click', ev => {
    if (ev.target.closest('button')) return;
    openFoodPicker(day.date, el.dataset.pickfood);
  }));
  root.querySelectorAll('[data-menu]').forEach(el => el.addEventListener('click', () => openItemMenu(day.date, el.dataset.menu)));
  root.querySelectorAll('[data-book]').forEach(el => el.addEventListener('click', ev => {
    ev.stopPropagation();
    openBookings();
  }));
  root.querySelector('[data-act="add"]')?.addEventListener('click', () => openAddSheet(day.date));
  root.querySelectorAll('[data-act="planner"]').forEach(b => b.addEventListener('click', () => openPlannerSheet()));
  root.querySelector('[data-act="theme"]')?.addEventListener('click', () => openThemePicker(day.date));
  root.querySelector('[data-act="bookings"]')?.addEventListener('click', openBookings);
  root.querySelector('[data-act="dismiss-daytrip"]')?.addEventListener('click', () => update(s => { s.settings.dismissed.daytrip = true; }));

  const tl = root.querySelector('#tl');
  if (tl && window.Sortable) {
    window.Sortable.create(tl, {
      handle: '.grip',
      draggable: '.tl-item',
      animation: 160,
      ghostClass: 'drag-ghost',
      onMove: evt => !evt.related.classList.contains('fixed'),
      onEnd: () => {
        const order = [...tl.querySelectorAll('.tl-item')].map(li => li.dataset.u);
        update(s => {
          const d = s.days.find(x => x.date === day.date);
          d.items.sort((a, b) => order.indexOf(a.u) - order.indexOf(b.u));
        });
      },
    });
  }
}

function setFood(date, u, foodId) {
  update(s => {
    const d = s.days.find(x => x.date === date);
    const i = d.items.findIndex(x => x.u === u);
    if (i < 0) return;
    const meal = d.items[i].meal || 'lunch';
    d.items[i] = { u, t: 'food', id: foodId, meal };
  });
}

export function openFoodPicker(date, u) {
  const st = store.state;
  const day = st.days.find(d => d.date === date);
  const c = computeDay(day, st, dayWeather(date));
  const idx = c.items.findIndex(x => x.u === u);
  const ci = c.items[idx];
  if (!ci) return;
  const near = nearLoc(c.items, idx) || TRIP.center;
  let mode = 'diet';
  const render = body => {
    const diet = mode === 'kosher' ? 'kosher-only' : mode === 'all' ? 'any' : st.settings.diet;
    const list = rankFood({ meal: ci.meal === 'snack' ? null : ci.meal, near, wd: c.wd, time: ci.start, diet }).slice(0, 30);
    body.querySelector('.picker-list').innerHTML = list.map(r => `
      <button class="pick-row" data-id="${r.f.id}">
        <span class="pick-emoji">${FOOD_TYPES[r.f.type]?.emoji || '🍽️'}</span>
        <span class="pick-main"><b>${esc(r.f.name)}</b><small>${esc(FOOD_TYPES[r.f.type]?.he || '')} · ${priceLevel(r.f.price)} · ${legOf(near, r.f)?.min ?? '?'} דק׳ ${legOf(near, r.f)?.mode === 'walk' ? 'הליכה' : 'נסיעה'}</small>
        <span class="badges">${foodBadges(r.f)}</span></span>
      </button>`).join('') || '<div class="empty">אין מקומות פתוחים שמתאימים — נסו "הכול".</div>';
    body.querySelectorAll('.pick-row').forEach(b => b.addEventListener('click', () => {
      setFood(date, u, b.dataset.id);
      s.close();
    }));
  };
  const s = openSheet({
    title: `${MEAL_LABEL[ci.meal] || 'ארוחה'} · ${fromMin(ci.start)}`,
    body: `<div class="seg seg-sm">
        <button class="on" data-m="diet">לפי ההעדפות</button><button data-m="kosher">כשר בלבד</button><button data-m="all">הכול</button>
      </div>
      <p class="muted small">ממוין לפי התאמה והמרחק מהתחנה הקודמת, ורק מקומות שפתוחים בשעה הזו.</p>
      <div class="picker-list"></div>`,
    onMount(body) {
      render(body);
      body.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => {
        mode = b.dataset.m;
        body.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('on', x === b));
        render(body);
      }));
    },
  });
}

function openItemMenu(date, u) {
  const st = store.state;
  const day = st.days.find(d => d.date === date);
  const it = day.items.find(x => x.u === u);
  if (!it) return;
  const e = it.id ? get(it.id) : null;
  const c = computeDay(day, st);
  const ci = c.items.find(x => x.u === u);
  const prev = c.items.slice(0, c.items.indexOf(ci)).reverse().find(x => x.loc);
  const fixed = it.t === 'fixed';
  const otherDays = PLANNABLE_DAYS.filter(d => d !== date);
  const durs = [15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240];
  const curDur = ci?.dur || 60;
  const title = e?.name || it.title || MEAL_LABEL[it.meal] || 'פריט';
  openSheet({
    title,
    cls: 'sheet-small',
    body: `
      <div class="menu-list">
        ${e ? `<button data-a="detail">${icon('info')}פרטים מלאים</button>` : ''}
        ${(it.t === 'food' || it.t === 'meal') ? `<button data-a="swapfood">${icon('swap')}החלפת מקום אוכל</button>` : ''}
        ${e?.booking === 'required' ? `<button data-a="booked">${icon('ticket')}${st.booked[e.id] ? 'סימון כלא הוזמן' : 'סימון שהזמנו כרטיסים ✓'}</button>` : ''}
        ${ci?.loc ? `<a href="${gmapsDir(ci.loc, prev?.loc)}" target="_blank" rel="noopener">${icon('nav')}ניווט לכאן</a>` : ''}
      </div>
      ${fixed ? '' : `
      <div class="menu-grid">
        <label class="field"><span>שעה קבועה</span>
          <input type="time" data-f="pin" value="${esc(it.pin || '')}" step="300"></label>
        <label class="field"><span>משך</span>
          <select data-f="dur">${durs.map(d => `<option value="${d}" ${d === curDur ? 'selected' : ''}>${fmtDur(d)}</option>`).join('')}${durs.includes(curDur) ? '' : `<option value="${curDur}" selected>${fmtDur(curDur)}</option>`}</select></label>
      </div>
      <label class="field"><span>הערה</span><input type="text" data-f="note" value="${esc(it.note || '')}" placeholder="למשל: כרטיסים במייל"></label>
      <div class="row-btns">
        <button class="btn btn-soft btn-sm" data-a="up">${icon('up')}למעלה</button>
        <button class="btn btn-soft btn-sm" data-a="down">${icon('down')}למטה</button>
        ${it.pin ? `<button class="btn btn-soft btn-sm" data-a="unpin">ביטול שעה קבועה</button>` : ''}
      </div>
      <h3 class="h3">העברה ליום אחר</h3>
      <div class="daybtns">${otherDays.map(d => `<button class="daybtn" data-move="${d}" ${e && closedOn(e, weekdayOf(d)) ? 'disabled' : ''}><b>${dayLabel(d)}</b><small>${e && closedOn(e, weekdayOf(d)) ? 'סגור' : '&nbsp;'}</small></button>`).join('')}</div>
      <button class="btn btn-danger-soft btn-block" data-a="remove">${icon('trash')}הסרה מהיום</button>`}
    `,
    onMount(body, close) {
      const patch = fn => update(s2 => {
        const d = s2.days.find(x => x.date === date);
        const target = d.items.find(x => x.u === u);
        if (target) fn(target, d);
      });
      body.querySelector('[data-a="detail"]')?.addEventListener('click', () => { close(); openDetail(e.id); });
      body.querySelector('[data-a="swapfood"]')?.addEventListener('click', () => { close(); setTimeout(() => openFoodPicker(date, u), 230); });
      body.querySelector('[data-a="booked"]')?.addEventListener('click', () => { toggleBooked(e.id); close(); });
      body.querySelector('[data-f="pin"]')?.addEventListener('change', ev => patch(t => {
        delete t.soft;
        if (ev.target.value) t.pin = ev.target.value; else delete t.pin;
      }));
      body.querySelector('[data-f="dur"]')?.addEventListener('change', ev => patch(t => { t.dur = +ev.target.value; }));
      body.querySelector('[data-f="note"]')?.addEventListener('change', ev => patch(t => { t.note = ev.target.value.trim() || undefined; }));
      body.querySelector('[data-a="unpin"]')?.addEventListener('click', () => { patch(t => { delete t.pin; delete t.soft; }); close(); });
      const move = dir => patch((t, d) => {
        const k = d.items.indexOf(t), j = k + dir;
        if (j < 0 || j >= d.items.length || d.items[j].t === 'fixed') return;
        [d.items[k], d.items[j]] = [d.items[j], d.items[k]];
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
          delete moved.pin;
          insertItem(to, moved);
        });
        close();
        toast(`הועבר ל${dayLabel(b.dataset.move)}`);
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

function openThemePicker(date) {
  const st = store.state;
  const opts = themeOptions(date, st);
  const wd = weekdayOf(date);
  openSheet({
    title: `נושא ל${dayLabel(date)}`,
    body: `<p class="muted small">בחירת נושא בונה את היום מחדש לפי הקצב שבחרתם. אפשר לבטל מיד אחרי.</p>
      <div class="theme-list">${opts.map(o => `
        <button class="theme-row" data-theme="${o.id}" ${o.blocked ? 'disabled' : ''}>
          <span class="theme-emoji">${o.t.emoji || '📍'}</span>
          <span><b>${esc(o.t.title)}</b><small>${o.blocked ? `לא מתאים ליום ${WD_LONG[wd]} (סגור)` : esc(o.t.blurb || '')}</small></span>
        </button>`).join('')}
        <button class="theme-row" data-theme="__empty"><span class="theme-emoji">🗒️</span><span><b>יום ריק</b><small>מתחילים מאפס ומוסיפים לבד</small></span></button>
      </div>`,
    onMount(body, close) {
      body.querySelectorAll('[data-theme]').forEach(b => b.addEventListener('click', () => {
        snapshot();
        update(s2 => {
          if (b.dataset.theme === '__empty') {
            const d = s2.days.find(x => x.date === date);
            d.theme = null; d.items = []; d.title = 'יום חופשי';
          } else {
            rebuildDay(s2, date, b.dataset.theme);
            delete s2.days.find(x => x.date === date).title;
          }
        });
        close();
        toast('היום נבנה מחדש', { action: 'ביטול', onAction: undo });
      }));
    },
  });
}

function catalog() {
  return [
    ...DB.places.map(e => ({ e, group: e.cat === 'experience' ? 'exp' : e.cat === 'shopping' ? 'shop' : e.cat === 'event' ? 'exp' : 'place' })),
    ...DB.food.map(e => ({ e, group: 'food' })),
    ...DB.daytrips.map(e => ({ e, group: 'trip' })),
  ];
}

function openAddSheet(date) {
  const st = store.state;
  const day = st.days.find(d => d.date === date);
  const wd = weekdayOf(date);
  const hotel = st.settings.hotelId ? get(st.settings.hotelId) : null;
  const pts = day.items.map(i => locOf(i, i.id ? get(i.id) : null, hotel)).filter(Boolean);
  const center = centroid(pts) || hotel || TRIP.center;
  const inDay = new Set(day.items.map(i => i.id).filter(Boolean));
  let group = 'place', q = '';
  const groups = [['place', 'אטרקציות'], ['food', 'אוכל'], ['exp', 'חוויות'], ['shop', 'שופינג'], ['trip', 'טיולי יום'], ['custom', 'אישי']];

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
      .filter(x => x.group === group)
      .filter(x => !ql || `${x.e.name} ${x.e.orig || ''} ${x.e.desc || ''}`.toLowerCase().includes(ql))
      .map(x => ({ ...x, km: distKm(center, x.e) ?? 99, closed: x.e.kind !== 'daytrip' && closedOn(x.e, wd) }))
      .sort((a, b) => (a.closed - b.closed) || (a.km - b.km))
      .slice(0, 60);
    if (!rows.length) return '<div class="empty">לא נמצא — נסו חיפוש אחר.</div>';
    return rows.map(({ e, km, closed }) => `
      <button class="pick-row ${closed ? 'is-closed' : ''}" data-id="${e.id}">
        <span class="pick-emoji">${emojiOf(e)}</span>
        <span class="pick-main"><b>${esc(e.name)}${inDay.has(e.id) ? ' ✓' : ''}</b>
          <small>${closed ? `סגור ביום ${WD_LONG[wd]}` : km < 50 ? `${fmtKm(km)} מהיום` : ''}${e.dur && e.kind === 'place' ? ` · ${fmtDur(e.dur)}` : ''}${e.kind === 'food' ? ` · ${priceLevel(e.price)}${e.kosher ? ' · ✡ כשר' : ''}` : ''}</small></span>
        <span class="pick-add">${icon('plus')}</span>
      </button>`).join('');
  };

  openSheet({
    title: `הוספה ל${dayLabel(date)}`,
    cls: 'sheet-tall',
    body: `<div class="search"><span>${icon('search')}</span><input type="search" placeholder="חיפוש…" data-q></div>
      <div class="chips-scroll" data-groups>${groups.map(([g, l]) => `<button class="chip ${g === group ? 'on' : ''}" data-g="${g}">${l}</button>`).join('')}</div>
      <div class="picker-list" data-list></div>`,
    onMount(body, close) {
      const list = body.querySelector('[data-list]');
      const draw = () => {
        list.innerHTML = listHtml();
        list.querySelectorAll('.pick-row').forEach(b => b.addEventListener('click', () => {
          const e = get(b.dataset.id);
          if (e.kind === 'daytrip') { close(); setTimeout(() => openDetail(e.id), 230); return; }
          update(s2 => {
            const d = s2.days.find(x => x.date === date);
            const item = { u: uid(), t: e.kind === 'food' ? 'food' : 'place', id: e.id };
            if (e.kind === 'food') item.meal = (e.meals || []).includes('dinner') ? 'dinner' : (e.meals || []).includes('lunch') ? 'lunch' : 'snack';
            insertItem(d, item);
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
            if (f.get('pin')) item.pin = f.get('pin');
            if (f.get('note')) item.note = f.get('note').trim();
            insertItem(d, item);
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

export function openBookings() {
  const st = store.state;
  const rows = [];
  const seen = new Set();
  for (const d of st.days) for (const it of d.items) {
    const e = it.id && get(it.id);
    if (!e || seen.has(e.id) || (e.booking !== 'required' && e.reserve !== 'required')) continue;
    seen.add(e.id);
    rows.push({ e, date: d.date });
  }
  openSheet({
    title: 'מה צריך להזמין מראש',
    body: rows.length ? `<p class="muted small">סמנו ✓ כשהזמנתם — ההתראות בלו״ז ייעלמו.</p>
      <div class="book-list">${rows.map(({ e, date }) => `
        <div class="book-row">
          <label class="check-line"><input type="checkbox" data-bk="${e.id}" ${st.booked[e.id] ? 'checked' : ''}>
            <span><b>${esc(e.name)}</b><small>${dayLabel(date)}${e.kind === 'food' ? ' · הזמנת מקום' : ''}</small></span></label>
          ${e.bookUrl || e.url ? `<a class="btn btn-soft btn-sm" href="${esc(e.bookUrl || e.url)}" target="_blank" rel="noopener">${icon('external')}להזמנה</a>` : ''}
        </div>`).join('')}</div>` : '<div class="empty">אין כרגע בלו״ז דברים שחייבים להזמין מראש 🎉</div>',
    onMount(body) {
      body.querySelectorAll('[data-bk]').forEach(cb => cb.addEventListener('change', () => toggleBooked(cb.dataset.bk)));
    },
  });
}
