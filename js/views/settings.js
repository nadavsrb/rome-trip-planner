// Settings: pace, interests, day trip, diet, start time, theme, and sharing/backup.
import { DB, get } from '../data.js';
import { store, update, snapshot, undo, encodeShare, replaceState, defaults } from '../store.js';
import { esc, icon, weekdayOf } from '../util.js';
import { PACES, DIETS, FULL_DAYS, generatePlan, bestDayForTrip } from '../planner.js';
import { openSheet, toast, confirmSheet } from '../ui.js';
import { dayLabel } from './common.js';

const INTERESTS = [
  ['art', '🖼️ אמנות ומוזיאונים לעומק'],
  ['food', '👩‍🍳 חוויות אוכל'],
  ['shopping', '🛍️ שופינג'],
  ['daytrip', '🚆 טיול יום מחוץ לרומא'],
];

function body(st) {
  const s = st.settings;
  const trip = s.dayTrip?.id ? get(s.dayTrip.id) : null;
  const tripDate = trip ? (FULL_DAYS.includes(s.dayTrip.date) ? s.dayTrip.date : bestDayForTrip(trip)) : '';
  return `
    <section class="set-sec">
      <h3 class="h3">קצב</h3>
      <div class="pace-cards">${Object.entries(PACES).map(([k, p]) => `
        <button class="pace-card ${s.pace === k ? 'on' : ''}" data-pace="${k}">
          <b>${p.label}</b><small>${esc(p.blurb)}</small></button>`).join('')}
      </div>
      <label class="field inline"><span>שעת יציאה בבוקר</span>
        <input type="time" data-start value="${esc(s.startTime)}" step="900">
        <small class="muted">ריק = לפי הקצב</small></label>
    </section>

    <section class="set-sec">
      <h3 class="h3">מה מעניין אתכם</h3>
      ${INTERESTS.map(([k, l]) => `<label class="switch-line"><span>${l}</span>
        <input type="checkbox" class="switch" data-int="${k}" ${s.interests[k] ? 'checked' : ''}></label>`).join('')}
      <div class="trip-pick ${s.interests.daytrip ? '' : 'hidden'}" data-trip-box>
        <label class="field"><span>לאן?</span>
          <select data-trip>
            <option value="">עוד לא בחרנו</option>
            ${DB.daytrips.map(t => `<option value="${t.id}" ${s.dayTrip?.id === t.id ? 'selected' : ''}>${esc(t.name)}${t.travelMin ? ` (${Math.round(t.travelMin / 6) / 10} ש׳ לכל כיוון)` : ''}</option>`).join('')}
          </select></label>
        <label class="field"><span>באיזה יום?</span>
          <select data-trip-day ${trip ? '' : 'disabled'}>
            ${FULL_DAYS.map(d => {
              const closed = trip && (trip.closed || []).includes(weekdayOf(d));
              return `<option value="${d}" ${tripDate === d ? 'selected' : ''}>${dayLabel(d)}${closed ? ' — אתרים סגורים' : ''}</option>`;
            }).join('')}
          </select></label>
      </div>
    </section>

    <section class="set-sec">
      <h3 class="h3">אוכל</h3>
      <div class="radio-list">${Object.entries(DIETS).map(([k, d]) => `
        <label class="radio-line"><input type="radio" name="diet" value="${k}" ${s.diet === k ? 'checked' : ''}><span>${esc(d.label)}</span></label>`).join('')}
      </div>
    </section>

    <div class="rebuild">
      <button class="btn btn-primary btn-block" data-rebuild>${icon('sparkles')}בניית לו״ז מחדש לפי ההגדרות</button>
      <small class="muted">שינוי קצב מעדכן מיד את השעות. בנייה מחדש גם מוסיפה או מורידה פעילויות, ומשבצת את המועדפים שלכם (♥). אפשר לבטל.</small>
    </div>

    <section class="set-sec">
      <h3 class="h3">שיתוף וגיבוי</h3>
      <p class="muted small">כל טלפון שומר את התוכנית אצלו. כדי שגם בת הזוג תראה את אותה תוכנית — שלחו לה קישור.</p>
      <div class="row-btns">
        <button class="btn btn-soft" data-share>${icon('share')}שיתוף התוכנית</button>
        <button class="btn btn-soft" data-wa>וואטסאפ</button>
      </div>
      <div class="row-btns">
        <button class="btn btn-ghost btn-sm" data-export>${icon('download')}גיבוי לקובץ</button>
        <label class="btn btn-ghost btn-sm">${icon('upload')}שחזור מקובץ<input type="file" accept="application/json" data-import hidden></label>
        <button class="btn btn-ghost btn-sm" data-reset>${icon('refresh')}איפוס</button>
      </div>
    </section>

    <section class="set-sec">
      <h3 class="h3">תצוגה</h3>
      <div class="seg seg-sm">${[['auto', 'אוטומטי'], ['light', 'בהיר'], ['dark', 'כהה']].map(([k, l]) =>
        `<button class="${s.theme === k ? 'on' : ''}" data-theme="${k}">${l}</button>`).join('')}</div>
    </section>`;
}

export function applyTheme() {
  const t = store.state?.settings.theme || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

async function shareUrl() {
  const token = await encodeShare();
  return `${location.origin}${location.pathname}#share=${token}`;
}

export async function shareNow() {
  const url = await shareUrl();
  if (navigator.share) {
    try { await navigator.share({ title: 'התוכנית שלנו לרומא', text: 'הלו״ז שלנו לרומא 🇮🇹', url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('הקישור הועתק — הדביקו בוואטסאפ'); } catch { window.prompt('העתיקו את הקישור:', url); }
}

function rebuild() {
  snapshot();
  update(s => { s.days = generatePlan(s); });
  toast('הלו״ז נבנה מחדש', { action: 'ביטול', onAction: undo, ms: 6000 });
}

export function openSettings() {
  openSheet({
    title: 'הגדרות הטיול',
    cls: 'sheet-tall',
    body: body(store.state),
    onMount(el, close) {
      const set = fn => update(s => fn(s.settings));
      el.querySelectorAll('[data-pace]').forEach(b => b.addEventListener('click', () => {
        set(s => { s.pace = b.dataset.pace; });
        el.querySelectorAll('[data-pace]').forEach(x => x.classList.toggle('on', x === b));
        toast(`קצב: ${PACES[b.dataset.pace].label} — השעות עודכנו`, { action: 'לבנות מחדש', onAction: rebuild });
      }));
      el.querySelector('[data-start]').addEventListener('change', ev => set(s => { s.startTime = ev.target.value; }));
      el.querySelectorAll('[data-int]').forEach(cb => cb.addEventListener('change', () => {
        set(s => { s.interests[cb.dataset.int] = cb.checked; });
        if (cb.dataset.int === 'daytrip') el.querySelector('[data-trip-box]').classList.toggle('hidden', !cb.checked);
      }));
      const tripSel = el.querySelector('[data-trip]');
      const daySel = el.querySelector('[data-trip-day]');
      tripSel.addEventListener('change', () => {
        const trip = get(tripSel.value);
        set(s => { s.dayTrip = { id: tripSel.value || null, date: trip ? bestDayForTrip(trip) : null }; });
        daySel.disabled = !trip;
        daySel.innerHTML = FULL_DAYS.map(d => {
          const closed = trip && (trip.closed || []).includes(weekdayOf(d));
          return `<option value="${d}" ${store.state.settings.dayTrip.date === d ? 'selected' : ''}>${dayLabel(d)}${closed ? ' — אתרים סגורים' : ''}</option>`;
        }).join('');
        if (trip) toast(`${trip.name}: הכי מתאים ב${dayLabel(store.state.settings.dayTrip.date)}`, { action: 'לבנות לו״ז', onAction: rebuild });
      });
      daySel.addEventListener('change', () => set(s => { s.dayTrip.date = daySel.value; }));
      el.querySelectorAll('input[name="diet"]').forEach(r => r.addEventListener('change', () => {
        set(s => { s.diet = r.value; });
        toast('העדפת האוכל נשמרה', { action: 'להחליף ארוחות', onAction: rebuild });
      }));
      el.querySelector('[data-rebuild]').addEventListener('click', async () => {
        const ok = await confirmSheet({ title: 'לבנות את הלו״ז מחדש?', text: 'כל הימים ייבנו מחדש לפי ההגדרות. שינויים ידניים יוחלפו — אבל אפשר ללחוץ "ביטול" מיד אחרי.', ok: 'בנייה מחדש' });
        if (!ok) return;
        close();
        rebuild();
      });
      el.querySelector('[data-share]').addEventListener('click', shareNow);
      el.querySelector('[data-wa]').addEventListener('click', async () => {
        const url = await shareUrl();
        window.open(`https://wa.me/?text=${encodeURIComponent(`הלו״ז שלנו לרומא 🇮🇹 ${url}`)}`, '_blank');
      });
      el.querySelector('[data-export]').addEventListener('click', () => {
        const blob = new Blob([JSON.stringify(store.state, null, 1)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'rome-plan-backup.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      });
      el.querySelector('[data-import]').addEventListener('change', async ev => {
        const file = ev.target.files?.[0];
        if (!file) return;
        try {
          const data = JSON.parse(await file.text());
          if (!Array.isArray(data.days)) throw new Error('bad');
          snapshot();
          replaceState(data);
          close();
          toast('התוכנית שוחזרה', { action: 'ביטול', onAction: undo });
        } catch { toast('הקובץ לא תקין'); }
      });
      el.querySelector('[data-reset]').addEventListener('click', async () => {
        const ok = await confirmSheet({ title: 'איפוס מלא?', text: 'כל ההגדרות, המועדפים והשינויים בטלפון הזה יימחקו והלו״ז ייבנה מחדש.', ok: 'איפוס', danger: true });
        if (!ok) return;
        snapshot();
        const fresh = defaults();
        fresh.days = generatePlan(fresh);
        replaceState(fresh);
        close();
        toast('אופס הכול', { action: 'ביטול', onAction: undo });
      });
      el.querySelectorAll('[data-theme]').forEach(b => b.addEventListener('click', () => {
        set(s => { s.theme = b.dataset.theme; });
        el.querySelectorAll('[data-theme]').forEach(x => x.classList.toggle('on', x === b));
        applyTheme();
      }));
    },
  });
}

export const openPlannerSheet = openSettings;
