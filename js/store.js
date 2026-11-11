// App state: settings, the day-by-day plan, favorites and bookings.
// Lives in localStorage on each phone; a share link carries it to the other phone.

const KEY = 'rome26:state:v1';
const listeners = new Set();
export const store = { state: null };

export function defaults() {
  return {
    v: 1,
    settings: {
      pace: 'balanced',
      interests: { art: true, food: true, shopping: true, daytrip: true },
      dayTrip: { id: null, date: null },
      diet: 'kosher-veg',
      hotelId: null,
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
  if (!saved || saved.v !== 1) return d;
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

export function load() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* private mode */ }
  store.state = merge(saved);
  return store.state;
}

let saveTimer;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(store.state)); } catch { /* storage full or blocked */ }
  }, 120);
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

// One level of undo for destructive actions (rebuild plan, remove, import).
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
  store.state = merge(next);
  save();
  emit();
}

// ---- Share links: state → deflate → base64url in the URL hash ----

const b64url = bytes => {
  let s = '';
  bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = str => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export function sharePayload(state = store.state) {
  const { settings, days, favs, booked, checks } = state;
  return { v: 1, settings, days, favs, booked, checks };
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
  if (!data || data.v !== 1 || !Array.isArray(data.days)) throw new Error('bad share');
  return data;
}
