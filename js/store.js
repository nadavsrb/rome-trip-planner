// App state: settings, the day-by-day plan, favorites and bookings.
// Lives in localStorage on each phone; sync (sync.js) or a share link carries it to the other phone.

const KEY = 'rome26:state:v2';
const OLD_KEY = 'rome26:state:v1';
const listeners = new Set();
const saveHooks = new Set();
export const store = { state: null, migrated: false };

export function defaults() {
  return {
    v: 2,
    settings: {
      pace: 'final',
      interests: { art: true, food: true, shopping: true, daytrip: false },
      dayTrip: { id: null, date: null },
      diet: 'any',
      hotelId: 'dimora-frattina',
      startTime: '',
      theme: 'auto',
      dismissed: {},
    },
    days: null,
    favs: [],
    booked: {},
    checks: {},
    compare: [],
  };
}

function merge(saved) {
  const d = defaults();
  if (!saved || saved.v !== 2) return d;
  return {
    ...d,
    ...saved,
    settings: {
      ...d.settings,
      ...saved.settings,
      interests: { ...d.settings.interests, ...(saved.settings?.interests || {}) },
      dayTrip: { ...d.settings.dayTrip, ...(saved.settings?.dayTrip || {}) },
      dismissed: { ...(saved.settings?.dismissed || {}) },
    },
  };
}

// The first version of the app generated its own plan. The final schedule replaces it;
// favorites, bookings and the checklist come along, and the old state is kept as a backup.
function fromV1(old) {
  const s = defaults();
  if (!old || typeof old !== 'object') return s;
  s.favs = Array.isArray(old.favs) ? old.favs : [];
  s.booked = old.booked && typeof old.booked === 'object' ? old.booked : {};
  s.checks = old.checks && typeof old.checks === 'object' ? old.checks : {};
  if (old.settings?.theme) s.settings.theme = old.settings.theme;
  return s;
}

export function load() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* private mode */ }
  if (!saved) {
    let old = null;
    try { old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null'); } catch { /* ignore */ }
    if (old) {
      try { localStorage.setItem('rome26:state:v1-backup', JSON.stringify(old)); localStorage.removeItem(OLD_KEY); } catch { /* ignore */ }
      store.state = fromV1(old);
      store.migrated = true;
      return store.state;
    }
  }
  store.state = merge(saved);
  return store.state;
}

let saveTimer;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(store.state)); } catch { /* storage full or blocked */ }
  }, 120);
  saveHooks.forEach(fn => { try { fn(store.state); } catch (e) { console.error(e); } });
}

const emit = () => listeners.forEach(fn => fn(store.state));

export function update(mutator, { silent = false } = {}) {
  mutator(store.state);
  save();
  if (!silent) emit();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Called after every change, rendered or not (sync uses it to notice local edits).
export function onSave(fn) {
  saveHooks.add(fn);
  return () => saveHooks.delete(fn);
}

// One level of undo for destructive actions (restore, remove, import).
let undoSnap = null;
export function snapshot() { undoSnap = JSON.stringify(store.state); }
export function undo() {
  if (!undoSnap) return false;
  store.state = merge(JSON.parse(undoSnap));
  undoSnap = null;
  save();
  emit();
  return true;
}

export function replaceState(next) {
  store.state = merge({ ...next, v: 2 });
  save();
  emit();
}

// ---- Share links: state → deflate → base64url in the URL hash ----

export const b64url = bytes => {
  let s = '';
  bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
export const unb64url = str => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export function sharePayload(state = store.state) {
  const { settings, days, favs, booked, checks } = state;
  return { v: 2, settings, days, favs, booked, checks };
}

export async function encodeShare(state = store.state) {
  const bytes = new TextEncoder().encode(JSON.stringify(sharePayload(state)));
  if ('CompressionStream' in window) {
    try { return 'z' + b64url(await pipe(bytes, new CompressionStream('deflate-raw'))); } catch { /* fall through */ }
  }
  return 'j' + b64url(bytes);
}

export async function decodeShare(token) {
  const kind = token[0];
  let bytes = unb64url(token.slice(1));
  if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (!data || data.v !== 2 || !Array.isArray(data.days)) throw new Error('bad share');
  return data;
}
