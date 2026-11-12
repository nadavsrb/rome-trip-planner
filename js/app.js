// Entry point: loads data and state, routes between the tabs, handles share links and offline.
import { loadData, get, DB } from './data.js';
import { load, store, update, subscribe, decodeShare, replaceState, snapshot, undo } from './store.js';
import { scheduleDays, TRIP } from './planner.js';
import { loadWeather } from './weather.js';
import { $, $$, romeToday, daysBetween, weekdayOf, WD_LONG } from './util.js';
import { toast, confirmSheet, dropAllSheets } from './ui.js';
import { renderPlan } from './views/plan.js';
import { renderExplore } from './views/explore.js';
import { renderFood } from './views/food.js';
import { renderHotels } from './views/hotels.js';
import { renderMap } from './views/map.js';
import { renderInfo } from './views/info.js';
import { openSettings, applyTheme, openShareSheet } from './views/settings.js';
import { initSync, joinSync, parseJoinToken, onSyncChange, syncConfig } from './sync.js';

const ROUTES = { plan: renderPlan, explore: renderExplore, food: renderFood, hotels: renderHotels, map: renderMap, info: renderInfo };
const scrolls = {};
let lastRoute = null;

function parseHash() {
  const m = location.hash.match(/^#\/(\w+)(?:\/([\w-]+))?/);
  const name = m && ROUTES[m[1]] ? m[1] : 'plan';
  return { name, param: m?.[2] || null };
}

function render() {
  const { name, param } = parseHash();
  const view = $('#view');
  const key = `${name}/${param || ''}`;
  if (lastRoute) scrolls[lastRoute] = window.scrollY;
  view.className = `view view-${name}`;
  ROUTES[name](view, param);
  $$('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === name));
  document.body.dataset.route = name;
  if (name !== 'map') window.scrollTo(0, key === lastRoute ? scrolls[key] || 0 : 0);
  lastRoute = key;
}

function countdown() {
  const today = romeToday();
  const d = daysBetween(today, TRIP.dates[0]);
  const i = TRIP.dates.indexOf(today);
  let text;
  if (d > 1) text = `עוד ${d} ימים לטיסה ✈️`;
  else if (d === 1) text = 'מחר טסים! ✈️';
  else if (i >= 0) text = `יום ${i + 1} מתוך 6 · ${WD_LONG[weekdayOf(today)]}`;
  else text = '<span dir="ltr">12–17</span> בנובמבר 2026';
  $('#countdown').innerHTML = text;
}

// Drop plan items that point at entries removed from the data files, and make sure
// every trip day exists.
function cleanPlan(s) {
  for (const d of s.days || []) {
    d.items = d.items.filter(it => !it.id || get(it.id));
    for (const it of d.items) {
      if (it.alts) {
        it.alts = it.alts.filter(get);
        if (it.alts.length < 2) delete it.alts;
      }
    }
  }
  // One-time corrections to plans saved before a data fix (e.g. Said moved to Via Tomacelli).
  s.fixes = s.fixes || [];
  for (const fx of DB.schedule?.fixes || []) {
    if (s.fixes.includes(fx.key)) continue;
    for (const d of s.days) {
      for (const it of d.items) {
        if (it.id === fx.id && Object.entries(fx.from || {}).every(([k, v]) => it[k] === v)) Object.assign(it, fx.set);
      }
    }
    s.fixes.push(fx.key);
  }
  const missing = TRIP.dates.filter(date => !s.days.some(d => d.date === date));
  if (missing.length) {
    s.days.push(...scheduleDays(missing));
    s.days.sort((a, b) => a.date.localeCompare(b.date));
  }
  if (!s.settings.hotelId || !get(s.settings.hotelId)) s.settings.hotelId = 'dimora-frattina';
}

// A sync invite from the other phone: #join=<token>
async function importJoin() {
  const m = location.hash.match(/^#join=(.+)$/);
  if (!m) return false;
  history.replaceState(null, '', `${location.pathname}#/plan`);
  if (ready) render();
  let target;
  try { target = parseJoinToken(m[1]); } catch { toast('קישור הסנכרון לא תקין או נקטע בהעתקה'); return true; }
  const cur = syncConfig();
  if (cur && cur.room === target.room) { toast('הטלפון הזה כבר מסונכרן ✓'); return true; }
  const ok = await confirmSheet({
    title: 'להצטרף ללו״ז המשותף? 🔄',
    text: 'מעכשיו שינויים יעברו אוטומטית בין שני הטלפונים. הלו״ז בטלפון הזה יוחלף בלו״ז המשותף.',
    ok: 'הצטרפות',
  });
  if (!ok) return true;
  try {
    snapshot();
    await joinSync(target.db, target.room);
    toast('מחוברים ✓ הלו״ז מסונכרן עם הטלפון השני', { ms: 5000 });
  } catch (e) {
    toast(e.message || 'לא הצלחנו להצטרף', { ms: 7000 });
  }
  return true;
}

async function importShared() {
  const m = location.hash.match(/^#share=(.+)$/);
  if (!m) return;
  history.replaceState(null, '', `${location.pathname}#/plan`);
  if (ready) render();
  try {
    const data = await decodeShare(m[1]);
    const n = data.days.reduce((k, d) => k + d.items.length, 0);
    const ok = await confirmSheet({
      title: 'קיבלתם תוכנית משותפת 💌',
      text: `להחליף את התוכנית בטלפון הזה בתוכנית שקיבלתם? (${data.days.length} ימים, ${n} פריטים, כולל הגדרות ומועדפים)`,
      ok: 'כן, להחליף',
    });
    if (!ok) return;
    snapshot();
    replaceState({ ...store.state, ...data });
    toast('התוכנית עודכנה', { action: 'ביטול', onAction: undo, ms: 6000 });
  } catch {
    toast('הקישור לא תקין או נקטע בהעתקה');
  }
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if (local && !location.search.includes('sw=1')) return;
  // When a new version takes over, reload into it right away (not on the very first install).
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.update().catch(() => {});
    // Check again whenever the app comes back to the foreground (phones keep it in memory).
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {});
}

// ---------- automatic updates ----------
// Every publish on GitHub Pages re-stamps all files, so when data/schedule.json has a newer
// Last-Modified than the copy this page loaded, a new version is out. Check when the app
// comes back to the foreground and every few minutes, and reload into it by itself
// (waiting for any open sheet to close first, so nothing typed is lost).
const UPDATE_KEY = 'rome26:update';
let newStamp = null;

async function publishedStamp() {
  try {
    const res = await fetch(`data/schedule.json?check=${Date.now()}`, { method: 'HEAD', cache: 'no-store' });
    return res.ok ? res.headers.get('last-modified') : null;
  } catch { return null; }
}

async function checkForUpdate() {
  if (!DB.stamp || document.visibilityState !== 'visible' || navigator.onLine === false) return;
  const latest = await publishedStamp();
  if (!latest || latest === DB.stamp) return;
  // Already reloaded for this version a moment ago and still got the old files (very slow
  // network): try again later instead of reloading in a loop.
  let last = null;
  try { last = JSON.parse(sessionStorage.getItem(UPDATE_KEY) || 'null'); } catch { /* ignore */ }
  if (last && last.stamp === latest && Date.now() - last.at < 10 * 60 * 1000) return;
  newStamp = latest;
  reloadWhenIdle();
}

function reloadWhenIdle() {
  if (!newStamp || document.body.classList.contains('sheet-open')) return;
  try { sessionStorage.setItem(UPDATE_KEY, JSON.stringify({ stamp: newStamp, at: Date.now() })); } catch { /* ignore */ }
  location.reload();
}

function startUpdateWatch() {
  // Right after a reload for an update: say so.
  try {
    const last = JSON.parse(sessionStorage.getItem(UPDATE_KEY) || 'null');
    if (last && last.stamp === DB.stamp && !last.shown) {
      toast('האתר עודכן לגרסה החדשה ✓');
      sessionStorage.setItem(UPDATE_KEY, JSON.stringify({ ...last, shown: true }));
    }
  } catch { /* ignore */ }
  setTimeout(checkForUpdate, 4000);
  setInterval(checkForUpdate, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
  window.addEventListener('online', checkForUpdate);
  window.addEventListener('sheets-closed', reloadWhenIdle);
}

let ready = false;

async function boot() {
  window.addEventListener('hashchange', () => {
    if (!ready) return;
    dropAllSheets();
    // A sync invite or a shared plan opened while the app is already open in this tab.
    if (location.hash.startsWith('#join=')) { importJoin(); return; }
    if (location.hash.startsWith('#share=')) { importShared(); return; }
    render();
  });
  load();
  applyTheme();
  try {
    await loadData();
  } catch (e) {
    $('#view').innerHTML = `<div class="empty">לא הצלחנו לטעון את הנתונים 😕<br><small>${String(e.message || e)}</small><br><button class="btn btn-primary" onclick="location.reload()">לנסות שוב</button></div>`;
    return;
  }
  if (!store.state.days) update(s => { s.days = scheduleDays(); }, { silent: true });
  update(cleanPlan, { silent: true });

  countdown();
  ready = true;
  render();
  subscribe(render);
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-share').addEventListener('click', openShareSheet);
  const dot = $('#sync-dot');
  const showSync = st => { if (dot) { dot.hidden = st.status === 'off'; dot.dataset.s = st.status; } };
  onSyncChange(showSync);
  if (store.migrated) toast('הלו״ז הסופי נטען ✓ התוכנית הקודמת נשמרה בגיבוי', { ms: 6000 });
  const joined = await importJoin();
  if (!joined) await importShared();
  initSync().catch(() => {});
  loadWeather().then(() => { if (['plan', 'info'].includes(parseHash().name)) render(); });
  registerSW();
  startUpdateWatch();
  setInterval(countdown, 60 * 60 * 1000);
}

boot().catch(e => {
  console.error(e);
  $('#view').innerHTML = `<div class="empty">משהו השתבש 😕<br><small dir="ltr">${String(e?.message || e)}</small><br><br>
    <button class="btn btn-primary" onclick="location.reload()">לנסות שוב</button></div>`;
});
