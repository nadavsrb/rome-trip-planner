// Settings: sync between the phones, share link and backup, restoring the final schedule, theme.
import { store, update, snapshot, undo, encodeShare, replaceState } from '../store.js';
import { DB } from '../data.js';
import { esc, icon } from '../util.js';
import { openSheet, toast, confirmSheet } from '../ui.js';
import { sync, onSyncChange, syncConfig, enableSync, disableSync, syncNow, joinLink } from '../sync.js';
import { restoreDays } from './plan.js';

function ago(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 10) return 'עכשיו';
  if (s < 60) return `לפני ${s} שניות`;
  const m = Math.round(s / 60);
  return m < 60 ? `לפני ${m} דק׳` : `לפני ${Math.round(m / 60)} שעות`;
}

function syncStatusHtml() {
  const map = {
    live: `<span class="sync-pill ok">● מסונכרן</span> <small class="muted">${ago(sync.last)}</small>`,
    connecting: '<span class="sync-pill">● מתחבר…</span>',
    offline: '<span class="sync-pill warn">● אין חיבור</span> <small class="muted">השינויים יישלחו כשיחזור האינטרנט</small>',
    error: `<span class="sync-pill bad">● תקלה</span> <small class="muted">${esc(sync.error)}</small>`,
    off: '<span class="sync-pill">כבוי</span>',
  };
  return map[sync.status] || map.off;
}

export function syncSectionHtml() {
  const on = !!syncConfig();
  return `<section class="set-sec" data-sync-sec>
    <h3 class="h3">🔄 סנכרון אוטומטי בין הטלפונים</h3>
    ${on ? `
      <div class="sync-status" data-sync-status>${syncStatusHtml()}</div>
      <p class="muted small">כל שינוי בלו״ז, בהזמנות או בצ׳קליסט מגיע לטלפון השני תוך כמה שניות. בלי אינטרנט הכול נשמר, ונשלח כשהחיבור חוזר.</p>
      <div class="row-btns">
        <button class="btn btn-primary" data-sync-invite>${icon('share')}שליחת קישור לטלפון השני</button>
        <button class="btn btn-soft btn-sm" data-sync-now>${icon('refresh')}סנכרון עכשיו</button>
      </div>
      <button class="btn btn-ghost btn-sm" data-sync-off>הפסקת הסנכרון בטלפון הזה</button>`
    : `
      <p class="muted small">עושים את זה פעם אחת, בטלפון אחד, ואז שולחים קישור לטלפון השני. צריך מסד נתונים חינמי של Firebase (בערך 5 דקות).</p>
      <button class="btn btn-soft btn-sm" data-sync-guide>${icon('info')}איך יוצרים את המסד (צעד אחרי צעד)</button>
      <label class="field"><span>כתובת ה-Realtime Database</span>
        <input type="url" dir="ltr" inputmode="url" autocomplete="off" placeholder="https://….firebasedatabase.app" data-sync-url></label>
      <button class="btn btn-primary btn-block" data-sync-on>הפעלת סנכרון</button>
      <small class="muted">כבר הופעל בטלפון השני? פותחים כאן את הקישור שהוא שלח, וזהו.</small>`}
  </section>`;
}

function guideSheet() {
  openSheet({
    title: 'יצירת מסד לסנכרון',
    body: `<ol class="steps">
      <li>נכנסים ל-<a href="https://console.firebase.google.com/" target="_blank" rel="noopener" dir="ltr">console.firebase.google.com</a> עם חשבון Google, ולוחצים <b dir="ltr">Create a project</b>. השם לא משנה (למשל rome-trip). את Google Analytics אפשר לכבות.</li>
      <li>בתפריט של הפרויקט מחפשים <b dir="ltr">Realtime Database</b> (בדרך כלל תחת Build או Databases) ולוחצים <b dir="ltr">Create Database</b>.</li>
      <li>מיקום: <b dir="ltr">Belgium (europe-west1)</b>. בשלב הכללים בוחרים <b dir="ltr">Start in test mode</b> ולוחצים <b dir="ltr">Enable</b>.</li>
      <li>מעתיקים את הכתובת שמופיעה מעל הנתונים. היא מתחילה ב-<span dir="ltr">https://</span> ונגמרת ב-<span dir="ltr">firebasedatabase.app</span> או <span dir="ltr">firebaseio.com</span>.</li>
      <li>מדביקים אותה בהגדרות, לוחצים "הפעלת סנכרון", ואז "שליחת קישור לטלפון השני".</li>
    </ol>
    <div class="tipbox">מצב test פתוח ל-30 יום, וזה מספיק לטיול. מי שיש לו את הקישור יכול לראות ולערוך את הלו״ז, אז שולחים אותו רק לטלפון השני.</div>`,
  });
}

export function bindSyncSection(el, rerender) {
  el.querySelector('[data-sync-guide]')?.addEventListener('click', guideSheet);
  el.querySelector('[data-sync-on]')?.addEventListener('click', async ev => {
    const btn = ev.currentTarget;
    const raw = el.querySelector('[data-sync-url]').value;
    btn.disabled = true;
    btn.textContent = 'מתחבר…';
    try {
      await enableSync(raw);
      toast('הסנכרון פועל ✓ עכשיו שולחים קישור לטלפון השני');
      rerender();
    } catch (e) {
      toast(e.message || 'לא הצלחנו להתחבר', { ms: 7000 });
      btn.disabled = false;
      btn.textContent = 'הפעלת סנכרון';
    }
  });
  el.querySelector('[data-sync-invite]')?.addEventListener('click', async () => {
    const url = joinLink();
    if (!url) return;
    const text = 'מצטרפים ללו״ז המשותף שלנו לרומא 🇮🇹 (לפתוח בטלפון השני)';
    if (navigator.share) {
      try { await navigator.share({ title: 'הלו״ז המשותף לרומא', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, '_blank');
  });
  el.querySelector('[data-sync-now]')?.addEventListener('click', async () => { await syncNow(); rerender(); });
  el.querySelector('[data-sync-off]')?.addEventListener('click', async () => {
    const ok = await confirmSheet({ title: 'להפסיק את הסנכרון?', text: 'הלו״ז נשאר בטלפון הזה, אבל שינויים כבר לא יעברו בין הטלפונים. אפשר להצטרף שוב מהקישור.', ok: 'הפסקה' });
    if (!ok) return;
    disableSync();
    rerender();
  });
}

function body(st) {
  const s = st.settings;
  return `
    ${syncSectionHtml()}

    <section class="set-sec">
      <h3 class="h3">שיתוף חד-פעמי וגיבוי</h3>
      <p class="muted small">בלי סנכרון: שולחים קישור עם התוכנית, והטלפון השני מקבל עותק שלה.</p>
      <div class="row-btns">
        <button class="btn btn-soft" data-share>${icon('share')}שליחת התוכנית</button>
        <button class="btn btn-soft" data-wa>וואטסאפ</button>
      </div>
      <div class="row-btns">
        <button class="btn btn-ghost btn-sm" data-export>${icon('download')}גיבוי לקובץ</button>
        <label class="btn btn-ghost btn-sm">${icon('upload')}שחזור מקובץ<input type="file" accept="application/json" data-import hidden></label>
      </div>
    </section>

    <section class="set-sec">
      <h3 class="h3">הלו״ז</h3>
      <button class="btn btn-soft btn-sm" data-restore>${icon('refresh')}שחזור כל הלו״ז הסופי המקורי</button>
      <small class="muted">מחזיר את ששת הימים לקובץ הלו״ז הסופי. אפשר לבטל מיד אחרי.</small>
    </section>

    <section class="set-sec">
      <h3 class="h3">תצוגה</h3>
      <div class="seg seg-sm">${[['auto', 'אוטומטי'], ['light', 'בהיר'], ['dark', 'כהה']].map(([k, l]) =>
        `<button class="${s.theme === k ? 'on' : ''}" data-theme="${k}">${l}</button>`).join('')}</div>
    </section>
    <p class="muted small center">גרסה ${APP_VERSION}${published() ? ` · עודכן ${published()}` : ''}</p>`;
}

// Shown at the bottom of the settings, to check which version a phone is running.
const APP_VERSION = 5;

// When the data this page runs on was published (Rome time), e.g. "12.11, 07:21".
function published() {
  const d = DB.stamp ? new Date(DB.stamp) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const v = t => f.find(p => p.type === t)?.value;
  return `${v('day')}.${v('month')}, ${v('hour')}:${v('minute')}`;
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
  try { await navigator.clipboard.writeText(url); toast('הקישור הועתק. אפשר להדביק בוואטסאפ'); } catch { window.prompt('העתיקו את הקישור:', url); }
}

// The share button in the top bar: sync first, a one-time link as the fallback.
export function openShareSheet() {
  let off = null;
  openSheet({
    title: 'שיתוף עם הטלפון השני',
    body: '<div data-share-body></div>',
    onMount(el) {
      const box = el.querySelector('[data-share-body]');
      const draw = () => {
        box.innerHTML = `${syncSectionHtml()}
          <section class="set-sec"><h3 class="h3">או: קישור חד-פעמי</h3>
            <p class="muted small">הטלפון השני מקבל עותק של התוכנית כפי שהיא עכשיו.</p>
            <button class="btn btn-soft btn-sm" data-share>${icon('share')}שליחת התוכנית</button></section>`;
        bindSyncSection(box, draw);
        box.querySelector('[data-share]').addEventListener('click', shareNow);
      };
      draw();
      off = onSyncChange(() => { const st = box.querySelector('[data-sync-status]'); if (st) st.innerHTML = syncStatusHtml(); });
    },
    onClose: () => off?.(),
  });
}

export function openSettings() {
  let off = null;
  openSheet({
    title: 'הגדרות',
    cls: 'sheet-tall',
    body: '<div data-settings-body></div>',
    onMount(wrap, close) {
      const el = wrap.querySelector('[data-settings-body]');
      const draw = () => {
        el.innerHTML = body(store.state);
        bindSyncSection(el, draw);
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
        el.querySelector('[data-restore]').addEventListener('click', async () => {
          const ok = await confirmSheet({ title: 'לשחזר את כל הלו״ז?', text: 'כל הימים יחזרו ללו״ז הסופי המקורי, והשינויים שעשיתם יימחקו (גם בטלפון השני, אם הסנכרון פועל). אפשר לבטל מיד אחרי.', ok: 'שחזור', danger: true });
          if (!ok) return;
          close();
          restoreDays();
        });
        el.querySelectorAll('[data-theme]').forEach(b => b.addEventListener('click', () => {
          update(s => { s.settings.theme = b.dataset.theme; });
          el.querySelectorAll('[data-theme]').forEach(x => x.classList.toggle('on', x === b));
          applyTheme();
        }));
      };
      draw();
      off = onSyncChange(() => { const st = el.querySelector('[data-sync-status]'); if (st) st.innerHTML = syncStatusHtml(); });
    },
    onClose: () => off?.(),
  });
}
