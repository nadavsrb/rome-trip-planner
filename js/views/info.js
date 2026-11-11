// Practical info: trip summary and forecast, pre-flight checklist, guides, emergency numbers.
import { DB } from '../data.js';
import { store, update } from '../store.js';
import { esc, ltr, richText, WD_SHORT, weekdayOf, dm, romeToday, daysBetween } from '../util.js';
import { TRIP } from '../planner.js';
import { dayWeather, wxIcon, CLIMATE } from '../weather.js';
import { openBookings } from './plan.js';

function forecast() {
  return `<div class="wx-row">${TRIP.dates.map(d => {
    const w = dayWeather(d);
    return `<div class="wx-day"><b>${WD_SHORT[weekdayOf(d)]} ${dm(d)}</b>
      <span class="wx-ic">${wxIcon(w?.code ?? CLIMATE.code)}</span>
      <span>${ltr(w ? `${w.tmin}°–${w.tmax}°` : `${CLIMATE.tmin}°–${CLIMATE.tmax}°`)}</span>
      <small>${w ? `${w.pop ?? '–'}% גשם` : 'ממוצע'}</small></div>`;
  }).join('')}</div>
  <p class="muted small">${dayWeather(TRIP.dates[0]) ? 'תחזית Open-Meteo, מתעדכנת אוטומטית.' : 'עדיין אין תחזית לתאריכים — מוצגים ממוצעים של אמצע נובמבר. התחזית תופיע כשבועיים לפני.'}</p>`;
}

function checklist(st) {
  const items = DB.info.checklist || [];
  const done = items.filter(i => st.checks[i.id]).length;
  return `<div class="progress"><span style="width:${items.length ? (done / items.length) * 100 : 0}%"></span></div>
    <div class="muted small">${done} מתוך ${items.length}</div>
    <div class="check-list">${items.map(i => `
      <label class="check-line"><input type="checkbox" data-check="${i.id}" ${st.checks[i.id] ? 'checked' : ''}>
        <span>${esc(i.text)}${i.link ? ` <a href="${esc(i.link)}" target="_blank" rel="noopener">קישור</a>` : ''}${i.note ? `<small>${esc(i.note)}</small>` : ''}</span></label>`).join('')}
    </div>
    <button class="btn btn-soft btn-sm" data-bookings>🎟️ כרטיסים שצריך להזמין לפי הלו״ז</button>`;
}

function emergency() {
  return `<div class="tel-grid">${(DB.info.emergency || []).map(e => `
    <a class="tel" href="tel:${esc(e.tel.replace(/[^\d+]/g, ''))}"><b>${esc(e.tel)}</b><span>${esc(e.label)}</span></a>`).join('')}</div>
    ${DB.info.emergencyText ? `<p class="small">${richText(DB.info.emergencyText)}</p>` : ''}`;
}

function phrases() {
  return `<div class="phrases">${(DB.info.phrases || []).map(p => `
    <div class="phrase"><b dir="ltr">${esc(p.it)}</b><span>${esc(p.he)}</span><small>${esc(p.say)}</small></div>`).join('')}</div>`;
}

export function renderInfo(root) {
  const st = store.state;
  const d = daysBetween(romeToday(), TRIP.dates[0]);
  const fl = DB.info.flights || {};
  const sections = DB.info.sections || [];
  root.innerHTML = `
    <section class="card trip-card">
      <div class="trip-top">
        <div><div class="muted small">רומא · ${ltr('12–17')} בנובמבר 2026</div>
          <h2 class="h2 tight">${d > 0 ? `עוד ${d} ימים ✈️` : d === 0 ? 'היום טסים! ✈️' : 'בטיול 🇮🇹'}</h2></div>
      </div>
      <div class="flights">
        <div><span>הלוך</span><b>ה׳ 12.11 · נחיתה 11:00</b><small>${esc(fl.arrive || 'רומא פיומיצ׳ינו (FCO)')}</small></div>
        <div><span>חזור</span><b>ג׳ 17.11 · המראה 10:05</b><small>${esc(fl.depart || 'רומא פיומיצ׳ינו (FCO)')}</small></div>
      </div>
      ${forecast()}
    </section>

    <details class="acc" open><summary>✅ צ׳קליסט לפני הטיסה</summary><div class="acc-body">${checklist(st)}</div></details>
    ${sections.map(s => `<details class="acc"><summary>${esc(s.icon || '')} ${esc(s.title)}</summary><div class="acc-body">${richText(s.body)}${s.links ? `<div class="link-row">${s.links.map(l => `<a class="btn btn-soft btn-sm" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</div>` : ''}</div></details>`).join('')}
    <details class="acc"><summary>🆘 חירום וטלפונים</summary><div class="acc-body">${emergency()}</div></details>
    <details class="acc"><summary>🗣️ משפטים באיטלקית</summary><div class="acc-body">${phrases()}</div></details>
    <details class="acc"><summary>📲 התקנה כאפליקציה</summary><div class="acc-body">
      <p><b>iPhone:</b> פותחים ב-Safari ← כפתור השיתוף ← "הוסף למסך הבית".</p>
      <p><b>אנדרואיד:</b> פותחים ב-Chrome ← תפריט ⋮ ← "התקנת אפליקציה" / "הוספה למסך הבית".</p>
      <p class="muted small">אחרי פתיחה ראשונה האפליקציה עובדת גם בלי אינטרנט (חוץ ממפה של אזורים שעוד לא נצפו ותחזית).</p>
    </div></details>
    <p class="muted small center">המידע נאסף בנובמבר 2026. שעות ומחירים משתנים — לפני ביקור כדאי לבדוק באתר הרשמי.</p>`;

  root.querySelectorAll('[data-check]').forEach(cb => cb.addEventListener('change', () => {
    update(s => { if (cb.checked) s.checks[cb.dataset.check] = true; else delete s.checks[cb.dataset.check]; });
  }));
  root.querySelector('[data-bookings]')?.addEventListener('click', openBookings);
}
