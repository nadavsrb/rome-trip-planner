// Automatic sync between our two phones through a Firebase Realtime Database
// (plain REST + a live event stream, no SDK).
//
// Each day of the plan, the bookings, the checklist and the favorites are separate keys.
// Every key carries the time it was last edited; the newer edit wins. A phone writes only
// the keys it changed (PATCH), so edits to different days never overwrite each other.
// Everything still works offline: changes wait and go up when the phone is back online.
import { store, update, onSave, b64url, unb64url } from './store.js';

const CFG_KEY = 'rome26:sync';
const META_KEY = 'rome26:sync-meta';
const DEV_KEY = 'rome26:device';

export const sync = { status: 'off', last: 0, error: '' };
const listeners = new Set();
export const onSyncChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const setStatus = (status, error = '') => {
  sync.status = status;
  sync.error = error;
  if (status === 'live') sync.last = Date.now();
  listeners.forEach(fn => { try { fn(sync); } catch (e) { console.error(e); } });
};

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch { return d; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

let cfg = read(CFG_KEY, null);
let meta = read(META_KEY, {});
let base = {};          // key → JSON of the value as last seen or sent
let rmeta = {};         // key → edit time of the copy on the server, as far as we know
let pending = new Set();
let es = null, pollTimer = null, pushTimer = null, offSave = null, quietUntil = 0;
const device = read(DEV_KEY, null) || (() => { const d = Math.random().toString(36).slice(2, 10); write(DEV_KEY, d); return d; })();

export const syncConfig = () => cfg;

// ---------- what gets synced ----------

function keysOf(s) {
  const out = {};
  for (const d of s.days || []) out[`day:${d.date}`] = d;
  out.booked = s.booked || {};
  out.checks = s.checks || {};
  out.favs = s.favs || [];
  return out;
}

function applyKey(s, k, v) {
  if (k.startsWith('day:')) {
    const date = k.slice(4);
    const i = s.days.findIndex(d => d.date === date);
    if (i >= 0) s.days[i] = v; else { s.days.push(v); s.days.sort((a, b) => a.date.localeCompare(b.date)); }
  } else if (k === 'booked' || k === 'checks' || k === 'favs') {
    s[k] = v;
  }
}

// ---------- REST ----------

export function normalizeDbUrl(raw) {
  let u = String(raw || '').trim();
  if (!u) return null;
  // Local testing against an emulator, only when the app itself runs on this machine.
  const local = /^(localhost|127\.0\.0\.1)$/;
  const m = u.match(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/);
  if (m && local.test(location.hostname)) return m[0];
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try {
    const url = new URL(u);
    if (!/(\.firebaseio\.com|\.firebasedatabase\.app)$/i.test(url.hostname)) return null;
    return `https://${url.hostname}`;
  } catch { return null; }
}

const url = (path = 'k') => `${cfg.db}/rooms/${cfg.room}/${path}.json`;

async function req(method, path, body) {
  const res = await fetch(url(path), {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); if (j?.error) msg += ` ${j.error}`; } catch { /* ignore */ }
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function explain(e) {
  if (e?.status === 401 || e?.status === 403) return 'אין הרשאה למסד הנתונים. בודקים ב-Firebase שהכללים במצב test (או שתקופת ה-test נגמרה).';
  if (e?.status === 404) return 'כתובת המסד לא נמצאה. בודקים שהעתקתם את הכתובת המלאה של ה-Realtime Database.';
  if (e?.status) return `שגיאה מהשרת (${e.status}).`;
  return 'אין חיבור לאינטרנט כרגע. השינויים יישלחו כשיחזור החיבור.';
}

// ---------- merge ----------

// `full`: data is the whole room (a GET, or the stream's first event); otherwise just some keys.
function mergeRemote(data, { announce = true, full = false } = {}) {
  if (!data || typeof data !== 'object') data = {};
  if (full) rmeta = {};
  const adopt = [];
  for (const [k, r] of Object.entries(data)) {
    if (!r || typeof r.t !== 'number' || typeof r.j !== 'string') continue;
    rmeta[k] = Math.max(rmeta[k] || 0, r.t);
    const lt = meta[k] || 0;
    if (r.t > lt) {
      if (r.j !== base[k]) {
        try { adopt.push([k, JSON.parse(r.j)]); base[k] = r.j; } catch { continue; }
      }
      meta[k] = r.t;
    }
  }
  // Anything we changed more recently than what's up there goes up.
  for (const k of Object.keys(keysOf(store.state))) {
    if ((meta[k] || 0) > (rmeta[k] || 0)) pending.add(k);
  }
  write(META_KEY, meta);
  if (adopt.length) {
    update(s => adopt.forEach(([k, v]) => applyKey(s, k, v)));
    if (announce && Date.now() > quietUntil) {
      import('./ui.js').then(({ toast }) => toast('הלו״ז עודכן מהטלפון השני 🔄'));
    }
  }
  if (pending.size) schedulePush(50);
}

// Local edits: compare each key with what we last saw, and stamp the ones that changed.
function detect(s) {
  if (!cfg) return;
  const now = Date.now();
  let changed = false;
  for (const [k, v] of Object.entries(keysOf(s))) {
    const j = JSON.stringify(v);
    if (j !== base[k]) { base[k] = j; meta[k] = now; pending.add(k); changed = true; }
  }
  if (changed) { write(META_KEY, meta); schedulePush(); }
}

function schedulePush(ms = 700) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, ms);
}

async function push() {
  if (!cfg || !pending.size) return;
  const keys = [...pending];
  const body = {};
  for (const k of keys) {
    if (!meta[k]) meta[k] = Date.now();
    body[k] = { t: meta[k], j: base[k], by: device };
  }
  try {
    await req('PATCH', 'k', body);
    // A key edited again while this request was out stays pending for the next push.
    keys.forEach(k => { rmeta[k] = Math.max(rmeta[k] || 0, body[k].t); if (body[k].t === meta[k]) pending.delete(k); });
    setStatus('live');
    if (pending.size) schedulePush();
  } catch (e) {
    setStatus(e?.status ? 'error' : 'offline', explain(e));
  }
}

export async function pull({ announce = true } = {}) {
  if (!cfg) return false;
  try {
    const data = await req('GET', 'k');
    mergeRemote(data, { announce, full: true });
    setStatus('live');
    return data;
  } catch (e) {
    setStatus(e?.status ? 'error' : 'offline', explain(e));
    return false;
  }
}

// ---------- live stream ----------

function openStream() {
  closeStream();
  if (!cfg || !('EventSource' in window)) return;
  try {
    es = new EventSource(url('k'));
  } catch { es = null; return; }
  const handle = ev => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (!msg) return;
    const { path, data } = msg;
    if (path === '/' || path === '') { mergeRemote(data, { full: ev.type === 'put' }); setStatus('live'); return; }
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 1) { mergeRemote({ [parts[0]]: data }); setStatus('live'); return; }
    pull(); // a change deep inside a key: just fetch everything
  };
  es.addEventListener('put', handle);
  es.addEventListener('patch', handle);
  es.addEventListener('cancel', () => { setStatus('error', 'אין הרשאה למסד הנתונים. בודקים ב-Firebase שהכללים במצב test.'); closeStream(); });
  es.addEventListener('auth_revoked', () => { closeStream(); });
  es.onerror = () => { if (navigator.onLine === false) setStatus('offline', explain(null)); };
}

function closeStream() {
  if (es) { try { es.close(); } catch { /* ignore */ } }
  es = null;
}

function onVisible() {
  if (document.visibilityState !== 'visible' || !cfg) return;
  pull();
  if (!es || es.readyState === 2) openStream();
}

function start() {
  base = {};
  rmeta = {};
  for (const [k, v] of Object.entries(keysOf(store.state))) base[k] = JSON.stringify(v);
  offSave?.();
  offSave = onSave(detect);
  openStream();
  clearInterval(pollTimer);
  // The stream is the fast path; a slow poll catches anything it missed.
  pollTimer = setInterval(() => { if (document.visibilityState === 'visible') { pull(); if (pending.size) push(); } }, 45 * 1000);
  setStatus('connecting');
}

function stop() {
  closeStream();
  clearInterval(pollTimer);
  clearTimeout(pushTimer);
  offSave?.();
  offSave = null;
  pending = new Set();
}

document.addEventListener('visibilitychange', onVisible);
window.addEventListener('online', () => { if (cfg) { pull(); push(); openStream(); } });

// ---------- public API ----------

export async function initSync() {
  if (!cfg) return;
  start();
  await pull({ announce: false });
}

// First phone: create a new shared room and upload this phone's plan.
export async function enableSync(rawUrl) {
  const db = normalizeDbUrl(rawUrl);
  if (!db) throw new Error('הכתובת צריכה להיות של Firebase Realtime Database: מסתיימת ב-firebasedatabase.app או ב-firebaseio.com');
  const room = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => (b % 36).toString(36)).join('');
  stop();
  cfg = { db, room };
  const now = Date.now();
  const body = {};
  for (const [k, v] of Object.entries(keysOf(store.state))) {
    meta[k] = now;
    body[k] = { t: now, j: JSON.stringify(v), by: device };
  }
  try {
    await req('PATCH', 'k', body);
  } catch (e) {
    cfg = null;
    setStatus('off');
    throw new Error(explain(e));
  }
  write(META_KEY, meta);
  write(CFG_KEY, cfg);
  start();
  for (const k of Object.keys(body)) rmeta[k] = now;
  setStatus('live');
}

// Second phone: join the room from the link and take the shared plan.
export async function joinSync(db, room) {
  const ndb = normalizeDbUrl(db);
  if (!ndb || !/^[a-z0-9]{8,40}$/.test(room || '')) throw new Error('קישור הסנכרון לא תקין');
  stop();
  cfg = { db: ndb, room };
  meta = {};
  write(META_KEY, meta);
  start();
  quietUntil = Date.now() + 5000;
  const data = await pull({ announce: false });
  if (data === false) { const err = sync.error; stop(); cfg = null; setStatus('off'); throw new Error(err || 'לא הצלחנו להתחבר'); }
  if (!data || !Object.keys(data).length) { stop(); cfg = null; setStatus('off'); throw new Error('לא מצאנו לו״ז משותף בקישור הזה'); }
  write(CFG_KEY, cfg);
}

export function disableSync() {
  stop();
  cfg = null;
  write(CFG_KEY, null);
  setStatus('off');
}

export async function syncNow() {
  if (!cfg) return;
  await pull();
  await push();
}

export function joinLink() {
  if (!cfg) return null;
  const token = b64url(new TextEncoder().encode(JSON.stringify({ d: cfg.db, r: cfg.room })));
  return `${location.origin}${location.pathname}#join=${token}`;
}

export function parseJoinToken(token) {
  const obj = JSON.parse(new TextDecoder().decode(unb64url(token)));
  return { db: obj.d, room: obj.r };
}
