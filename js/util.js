// Small DOM, time and formatting helpers shared by every view.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Keeps "9:00–17:00" or "€150–250" reading left-to-right inside Hebrew text.
export const ltr = s => `<span dir="ltr">${s}</span>`;
const RANGE = /(€?\d[\d.,:]*\s?[–-]\s?€?\d[\d.,:]*°?|\d{1,2}:\d{2})/g;
export const bidi = v => esc(v).replace(RANGE, m => ltr(m));

// Turns "line\n• bullet" text from the data files into safe HTML.
export function richText(v) {
  return bidi(v).replace(/\n/g, '<br>');
}

export const WD_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
export const WD_LONG = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export const pad2 = n => String(n).padStart(2, '0');

export function toMin(t) {
  if (t == null || t === '') return null;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

export function fromMin(m) {
  m = Math.round(m);
  const h = Math.floor(m / 60) % 24;
  return `${pad2(h)}:${pad2(((m % 60) + 60) % 60)}`;
}

export function fmtDur(min) {
  min = Math.round(min);
  if (min < 60) return `${min} דק׳`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}:${pad2(m)} ש׳` : `${h} ש׳`;
}

export const fmtKm = km => (km < 1 ? `${Math.round(km * 100) * 10} מ׳` : `${km.toFixed(1)} ק״מ`);
export const euro = n => `€${Math.round(n).toLocaleString('en-US')}`;
export const priceLevel = n => '€'.repeat(Math.max(1, Math.min(4, n || 1)));
export const uid = () => Math.random().toString(36).slice(2, 10);

export function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const weekdayOf = iso => new Date(iso + 'T12:00:00Z').getUTCDay();
export const dm = iso => { const [, m, d] = iso.split('-'); return `${+d}.${+m}`; };

// Times in the app are always Rome local time, whatever the phone's zone is.
export function romeToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function romeNowMin() {
  const s = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date());
  return toMin(s);
}

export function daysBetween(aIso, bIso) {
  return Math.round((Date.parse(bIso + 'T12:00:00Z') - Date.parse(aIso + 'T12:00:00Z')) / 86400000);
}

// Line icons drawn on a 24×24 grid, stroked with currentColor.
const ICONS = {
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  food: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1.2-3 4-3 7.5h3"/>',
  bed: '<path d="M3 19v-8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8M3 15h18M7 9V7.5A1.5 1.5 0 0 1 8.5 6h2A1.5 1.5 0 0 1 12 7.5V9"/>',
  map: '<path d="M3 6.5l6-3 6 3 6-3v14l-6 3-6-3-6 3z"/><path d="M9 3.5v14M15 6.5v14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.6v.01"/>',
  tune: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  pin: '<path d="M12 21s-6.5-6.4-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.6 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevL: '<path d="M14.5 6l-6 6 6 6"/>',
  chevR: '<path d="M9.5 6l6 6-6 6"/>',
  chevD: '<path d="M6 9.5l6 6 6-6"/>',
  grip: '<g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></g>',
  more: '<g fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></g>',
  nav: '<path d="M3.5 11L20.5 3.5 13 20.5l-2-7.5z"/>',
  sparkles: '<path d="M11 3.5l1.7 4.4 4.4 1.7-4.4 1.7L11 15.7l-1.7-4.4-4.4-1.7 4.4-1.7zM18.5 14l.9 2.2 2.1.8-2.1.9-.9 2.1-.8-2.1-2.2-.9 2.2-.8z"/>',
  external: '<path d="M14 4h6v6M20 4l-8.5 8.5M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  locate: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 13.5l5-5 5 5M5 4h14"/>',
  refresh: '<path d="M20 11.5a8 8 0 1 1-2.4-5.7M20 4.5V10h-5.5"/>',
  swap: '<path d="M7 4L3.5 7.5 7 11M3.5 7.5H17M17 20l3.5-3.5L17 13M20.5 16.5H7"/>',
  up: '<path d="M6 14.5l6-6 6 6"/>',
  down: '<path d="M6 9.5l6 6 6-6"/>',
  ticket: '<path d="M3 8.5V6h18v2.5a2.5 2.5 0 0 0 0 5V18H3v-4.5a2.5 2.5 0 0 0 0-5z"/><path d="M14 6v12" stroke-dasharray="2 2"/>',
  compare: '<rect x="3" y="4" width="7.5" height="16" rx="1.5"/><rect x="13.5" y="4" width="7.5" height="16" rx="1.5"/>',
  phone: '<path d="M5 4h3.5l1.8 4.5-2.3 1.5a11 11 0 0 0 6 6l1.5-2.3L20 15.5V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export const CATS = {
  ancient: { he: 'רומא העתיקה', emoji: '🏛️' },
  museum: { he: 'מוזיאונים ואמנות', emoji: '🖼️' },
  church: { he: 'כנסיות', emoji: '⛪' },
  piazza: { he: 'כיכרות ומזרקות', emoji: '⛲' },
  view: { he: 'תצפיות', emoji: '🌅' },
  park: { he: 'פארקים וגנים', emoji: '🌳' },
  neighborhood: { he: 'שכונות', emoji: '🏘️' },
  jewish: { he: 'רומא היהודית', emoji: '🕍' },
  market: { he: 'שווקים', emoji: '🧺' },
  experience: { he: 'חוויות וסיורים', emoji: '✨' },
  shopping: { he: 'שופינג', emoji: '🛍️' },
  event: { he: 'אירועים בתאריכים שלכם', emoji: '🎭' },
  daytrip: { he: 'טיולי יום', emoji: '🚆' },
};

// Map and list icons: restaurants get pasta, cafés and bakeries get coffee, and so on.
export const FOOD_TYPES = {
  restaurant: { he: 'מסעדה', emoji: '🍝' },
  trattoria: { he: 'טרטוריה', emoji: '🍝' },
  pizza: { he: 'פיצה', emoji: '🍕' },
  sushi: { he: 'סושי ויפני', emoji: '🍣' },
  street: { he: 'אוכל רחוב', emoji: '🥪' },
  gelato: { he: 'גלידה', emoji: '🍦' },
  dessert: { he: 'קינוחים ומאפים מתוקים', emoji: '🍰' },
  chocolate: { he: 'שוקולד', emoji: '🍫' },
  coffee: { he: 'קפה וארוחת בוקר', emoji: '☕' },
  bakery: { he: 'מאפייה', emoji: '☕' },
  aperitivo: { he: 'בר ואפריטיבו', emoji: '🍹' },
  wine: { he: 'בר יין', emoji: '🍷' },
  market: { he: 'שוק ואוכל', emoji: '🧺' },
  grocery: { he: 'מכולת וטייק-אווי', emoji: '🛒' },
  fine: { he: 'ערב מיוחד', emoji: '🥂' },
};

export const AREAS_FALLBACK = {
  centro: 'המרכז ההיסטורי', tridente: 'המדרגות הספרדיות והקורסו', monti: 'מונטי',
  ancient: 'רומא העתיקה', ghetto: 'הגטו היהודי', trastevere: 'טרסטוורה', vatican: 'הוותיקן ופראטי',
  borghese: 'וילה בורגזה', aventine: 'אוונטינו וטסטצ׳ו', esquilino: 'טרמיני ואסקווילינו',
  appia: 'דרך אפיה', sanlorenzo: 'סן לורנצו', other: 'מחוץ למרכז',
};
