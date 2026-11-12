// The planning engine: assigns a theme to each day, picks activities by pace,
// times the day (walking legs, opening hours, sunset) and fills meals by diet.
import { DB, get } from './data.js';
import { toMin, fromMin, weekdayOf, uid, WD_LONG } from './util.js';
import { distKm, leg, sunTimes, centroid } from './geo.js';
import { windowWx, wetness } from './weather.js';

export const TRIP = {
  dates: ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17'],
  arrive: { date: '2026-11-12', time: '11:00' },
  depart: { date: '2026-11-17', time: '10:05' },
  airport: { lat: 41.7999, lng: 12.2462, name: 'Fiumicino (FCO)' },
  termini: { lat: 41.9009, lng: 12.5013 },
  center: { lat: 41.8986, lng: 12.4769 },
};
export const FULL_DAYS = TRIP.dates.slice(1, 5);
export const PLANNABLE_DAYS = TRIP.dates.slice(0, 5);

// capacity = minutes of sightseeing (meals excluded) before a day counts as full.
export const PACES = {
  final: { label: 'הלו״ז שלנו', start: '09:00', buffer: 0, maxTier: 3, capacity: 99999, lunch: 60, dinner: 90, snack: 25,
    blurb: 'השעות של הלו״ז הסופי שלנו' },
  relaxed: { label: 'רגוע', start: '09:30', buffer: 20, maxTier: 2, capacity: 300, lunch: 90, dinner: 120, snack: 30,
    blurb: 'יוצאים ב-9:30, עד כ-5 שעות פעילות ביום, הפסקות ארוכות' },
  balanced: { label: 'מאוזן', start: '09:00', buffer: 10, maxTier: 3, capacity: 450, lunch: 75, dinner: 105, snack: 25,
    blurb: 'יוצאים ב-9:00, כ-7.5 שעות פעילות, זמן לקפה וארוחות בנחת' },
  intensive: { label: 'אינטנסיבי', start: '08:30', buffer: 5, maxTier: 3, capacity: 600, lunch: 60, dinner: 90, snack: 20,
    blurb: 'יוצאים ב-8:30, עד כ-10 שעות פעילות, רואים כמה שיותר' },
};

export const MEAL_LABEL = { lunch: 'ארוחת צהריים', dinner: 'ארוחת ערב', snack: 'עצירה קטנה', breakfast: 'ארוחת בוקר' };
const MEAL_NOT_BEFORE = { lunch: toMin('12:30'), dinner: toMin('19:30') };

export const DIETS = {
  'kosher-veg': { label: 'כשר קודם, צמחוני במקומות לא כשרים' },
  'kosher-only': { label: 'רק מסעדות כשרות' },
  veg: { label: 'צמחוני (כשרות לא משנה)' },
  any: { label: 'בלי הגבלות' },
};

export const paceOf = state => PACES[state.settings.pace] || PACES.final;

// ---------- opening hours ----------

export function hoursFor(e, wd) {
  if (!e) return null;
  if (e.open && Object.keys(e.open).length) {
    const r = e.open[String(wd)];
    if (!r) return [];
    return r.map(([a, b]) => {
      const s = toMin(a);
      let t = toMin(b);
      if (t <= s) t += 1440; // closes after midnight
      return [s, t];
    });
  }
  if (Array.isArray(e.closed) && e.closed.includes(wd)) return [];
  return null; // unknown: assume open
}

export const closedOn = (e, wd) => {
  const h = hoursFor(e, wd);
  return Array.isArray(h) && h.length === 0;
};

export function checkOpen(e, wd, start, end) {
  const ranges = hoursFor(e, wd);
  if (ranges === null) return { ok: true };
  if (!ranges.length) return { ok: false, type: 'closed' };
  for (const [a, b] of ranges) {
    if (start >= a && start < b) return end <= b + 10 ? { ok: true } : { ok: false, type: 'closes', at: b };
  }
  const next = ranges.find(([a]) => a > start);
  if (next) return { ok: false, type: 'notyet', at: next[0] };
  return { ok: false, type: 'over', at: ranges[ranges.length - 1][1] };
}

function openWarning(chk, wd) {
  switch (chk.type) {
    case 'closed': return { lvl: 'hi', type: 'hours', text: `סגור ביום ${WD_LONG[wd]}` };
    case 'closes': return { lvl: 'mid', type: 'hours', text: `נסגר ב-${fromMin(chk.at)} — לא יספיק לכל הביקור` };
    case 'notyet': return { lvl: 'mid', type: 'hours', text: `נפתח רק ב-${fromMin(chk.at)}` };
    default: return { lvl: 'hi', type: 'hours', text: `סגור בשעה הזו (נסגר ב-${fromMin(chk.at)})` };
  }
}

// ---------- item helpers ----------

const hotelOf = state => (state.settings.hotelId ? get(state.settings.hotelId) : null);

export function locOf(it, e, hotel) {
  switch (it.t) {
    case 'fixed':
      if (it.kind === 'hotel') return hotel || null;
      if (it.kind === 'airport' || it.kind === 'flight') return TRIP.airport;
      return null;
    case 'custom': return it.lat != null ? { lat: it.lat, lng: it.lng } : null;
    case 'meal':
    case 'daytrip': return null;
    default: return e && e.lat != null ? { lat: e.lat, lng: e.lng } : null;
  }
}

export function daytripSpan(trip) {
  const p = trip?.plan || [];
  if (p.length >= 2) return Math.max(180, toMin(p[p.length - 1].t) - toMin(p[0].t) + 30);
  return trip?.dur === 'half' ? 300 : 600;
}

export function durOf(it, e, pace) {
  if (it.dur) return it.dur;
  if (it.t === 'food' || it.t === 'meal') {
    if (it.meal === 'lunch') return pace.lunch;
    if (it.meal === 'dinner') return pace.dinner;
    if (it.meal === 'breakfast') return 40;
    return e?.dur || pace.snack;
  }
  if (it.t === 'daytrip') return daytripSpan(e);
  if (it.t === 'fixed') return it.dur || 0;
  return e?.dur || 60;
}

function dayStartMin(state) {
  return toMin(state.settings.startTime) ?? toMin(paceOf(state).start);
}

// ---------- weather ----------

// How exposed a stop is to the weather: outdoor, view, street (shopping street), boat,
// rooftop, queue (indoors, but the line is outside), takeaway (street food), or null.
export function wxExposure(it, e) {
  if (!e || it.t === 'fixed' || it.t === 'meal' || it.t === 'custom' || it.t === 'daytrip') return null;
  if (e.wx) return e.wx === 'indoor' ? null : e.wx;
  if (e.kind === 'food') return e.type === 'street' ? 'takeaway' : null;
  if (e.cat === 'view') return 'view';
  if (e.indoor === true) return null;
  if (e.indoor === false || ['piazza', 'park', 'market', 'neighborhood'].includes(e.cat)) return 'outdoor';
  return null;
}

export function weatherWarns(exp, w, { atSunset = false, start = 0 } = {}) {
  const out = [];
  if (!exp || !w) return out;
  const wet = wetness(w);
  const storm = w.code >= 95;
  const chance = w.pop != null ? ` (${w.pop}%)` : w.mm >= 0.2 ? ` (~${w.mm.toFixed(1)} מ״מ)` : '';
  const push = (lvl, text) => out.push({ lvl, type: 'wx', text });
  switch (exp) {
    case 'boat':
      if (storm || wet >= 2) push('hi', `🚣 צפוי גשם בזמן הזה${chance}, כנראה לא ישכירו סירות`);
      else if (wet === 1) push('mid', `☂️ אפשרות לגשם${chance}, ייתכן שלא ישכירו סירות`);
      if (w.gust >= 35) push('hi', `💨 רוח חזקה (משבים עד ${w.gust} קמ״ש), כנראה לא ישכירו סירות`);
      break;
    case 'rooftop':
      if (storm || wet >= 2) push('mid', `☔ צפוי גשם${chance}: הגג עלול להיות סגור, כדאי לבדוק או להזמין שולחן בפנים`);
      else if (wet === 1) push('lo', `☂️ אפשרות לגשם${chance}`);
      if (w.gust >= 40) push('mid', `💨 רוח חזקה על הגג (משבים עד ${w.gust} קמ״ש)`);
      if (w.tmin <= 11) push('lo', `🧥 קר על הגג (${w.tmin}°), כדאי מעיל`);
      break;
    case 'queue':
      if (wet >= 2) push('lo', `☔ צפוי גשם${chance}, והתור בחוץ: מטריה`);
      break;
    case 'takeaway':
      if (wet >= 2) push('lo', `☔ צפוי גשם${chance}: לאכול בפנים או במקום מקורה`);
      break;
    default: // outdoor, view, street
      if (storm) push('hi', '⛈️ סופת רעמים צפויה בזמן הזה');
      else if (wet === 3) push('mid', exp === 'street' ? `☔ גשם חזק צפוי${chance}: גלריה אלברטו סורדי ולה רינשנטה מקורות, אפשר להמשיך שם` : `☔ גשם חזק צפוי בזמן הזה${chance}`);
      else if (wet === 2) push('mid', exp === 'street' ? `☔ צפוי גשם${chance}: מטריה, ואפשר להיכנס לחנויות` : `☔ צפוי גשם בזמן הזה${chance}, כדאי מטריה`);
      else if (wet === 1) push('lo', `☂️ אפשרות לגשם${chance}`);
      if (exp === 'view' && atSunset && wet < 2 && w.cloud >= 85) push('lo', '☁️ מעונן מאוד, השקיעה כנראה לא תיראה');
      if (w.gust >= 55) push('lo', `💨 רוח חזקה (משבים עד ${w.gust} קמ״ש)`);
      if (start >= 18 * 60 && w.tmin <= 8) push('lo', `🧥 קר בערב (${w.tmin}°)`);
  }
  return out;
}

// ---------- timing one day ----------

export function computeDay(day, state, weather = null) {
  const pace = paceOf(state);
  const wd = weekdayOf(day.date);
  const sun = weather?.sunset ? { sunrise: weather.sunrise, sunset: weather.sunset } : sunTimes(day.date);
  const sunset = toMin(sun.sunset);
  const hotel = hotelOf(state);
  const isArrival = day.date === TRIP.dates[0];
  const isDeparture = day.date === TRIP.dates[5];
  const start0 = dayStartMin(state);

  const out = [];
  let cursor = null;
  let prev = isArrival ? TRIP.airport : hotel;
  let leave = null, activity = 0, walkKm = 0;

  for (let k = 0; k < day.items.length; k++) {
    const it = day.items[k];
    const e = it.id ? get(it.id) : null;
    const loc = locOf(it, e, hotel);
    let dur = durOf(it, e, pace);
    const warns = [], hints = [];
    const lg = prev && loc && it.t !== 'fixed' ? leg(prev, loc) : null;
    const travel = lg ? lg.min : 0;

    let earliest;
    if (cursor == null) earliest = start0 + travel;
    else if (it.t === 'fixed') earliest = cursor;
    else earliest = cursor + pace.buffer + travel;

    let start = earliest, gap = 0;
    const pin = toMin(it.pin);
    if (pin != null) {
      if (cursor == null || pin >= earliest) { gap = cursor == null ? 0 : pin - earliest; start = pin; }
      else if (!it.soft) warns.push({ lvl: 'hi', text: `לא תספיקו להגיע ב-${it.pin} (הגעה משוערת ${fromMin(earliest)})` });
    } else {
      const nb = (it.t === 'food' || it.t === 'meal') ? MEAL_NOT_BEFORE[it.meal] : WHEN_NOT_BEFORE[e?.when];
      if (nb && start < nb) { gap += nb - start; start = nb; }
    }

    // A "fit" stop (resting at the hotel, wandering the Corso) stretches until it's time
    // to walk to the next stop with a fixed time.
    if (it.fit) {
      const nx = day.items[k + 1];
      const npin = nx ? toMin(nx.pin) : null;
      if (npin != null) {
        const ne = nx.id ? get(nx.id) : null;
        const from = loc || prev;
        const nloc = locOf(nx, ne, hotel);
        const tl = from && nloc && nx.t !== 'fixed' ? leg(from, nloc) : null;
        dur = Math.max(it.min || 15, npin - start - (tl ? tl.min : 0) - pace.buffer);
      } else {
        dur = it.dur || e?.dur || 30;
      }
    }

    let atSunset = false;
    if (e && it.t !== 'daytrip' && e.kind !== 'hotel') {
      // A restaurant only needs to seat you about half an hour before it closes.
      const need = e.kind === 'food' ? Math.min(dur, 30) : dur;
      let chk = checkOpen(e, wd, start, start + need);
      if (chk.type === 'notyet' && pin == null && chk.at - start <= 120) {
        gap += chk.at - start;
        start = chk.at;
        chk = checkOpen(e, wd, start, start + need);
      }
      if (!chk.ok) warns.push(openWarning(chk, wd));
      if (chk.ok && e.lastEntry && start > toMin(e.lastEntry)) warns.push({ lvl: 'hi', type: 'hours', text: `כניסה אחרונה ב-${e.lastEntry}` });
      const tags = e.tags || [];
      atSunset = (tags.includes('view') || e.cat === 'view') && Math.abs(start + dur / 2 - sunset) <= 35;
      const fineAfterDark = tags.includes('night') || ['shopping', 'event', 'experience'].includes(e.cat);
      if (atSunset) hints.push(`🌅 בדיוק בשקיעה (${sun.sunset})`);
      else if (e.kind === 'place' && e.indoor === false && !fineAfterDark && start >= sunset + 15) {
        warns.push({ lvl: 'lo', text: `כבר יהיה חושך (שקיעה ${sun.sunset})` });
      }
      if (e.booking === 'required' && !state.booked[e.id]) warns.push({ lvl: 'mid', type: 'book', text: 'צריך להזמין מראש' });
      if (e.kind === 'food' && e.reserve === 'required' && !state.booked[e.id]) warns.push({ lvl: 'mid', type: 'book', text: 'צריך להזמין מקום מראש' });
      if (e.kind === 'food' && e.kosher?.shabbat && (wd === 5 || wd === 6) && !chk.ok) {
        hints.push('✡ מסעדה כשרה — סגורה בשבת');
      }
    }

    const exp = wxExposure(it, e);
    const ww = exp ? windowWx(day.date, start, start + Math.max(dur, 20)) : null;
    if (ww) warns.push(...weatherWarns(exp, ww, { atSunset, start }));

    if (cursor == null) leave = start - travel;
    const end = start + dur;
    if ((it.t === 'place' && !isFoodExperience(e)) || it.t === 'daytrip' || it.t === 'custom') activity += dur;
    if (lg && lg.mode === 'walk') walkKm += lg.km;
    out.push({ ...it, e, loc, dur, start, end, leg: lg, gap, warns, hints, wxExp: exp, wxw: ww });
    cursor = end;
    if (loc) prev = loc;
    else if (it.t === 'fixed' && (it.kind === 'hotel' || it.kind === 'transfer')) prev = hotel;
    else if (it.t === 'daytrip') prev = TRIP.termini;
  }

  const back = !isDeparture && hotel && prev && prev !== hotel ? leg(prev, hotel) : null;
  const dayWarns = [];
  const tripDay = day.items.some(x => x.t === 'daytrip');
  if (!tripDay && activity > pace.capacity * 1.15) {
    dayWarns.push({ lvl: 'mid', text: `יום עמוס לקצב "${pace.label}" — כ-${Math.round(activity / 60)} שעות פעילות` });
  }
  if (cursor != null && cursor > toMin('23:45')) dayWarns.push({ lvl: 'lo', text: 'היום מסתיים מאוחר מאוד' });
  if (walkKm > 14) dayWarns.push({ lvl: 'lo', text: `הרבה הליכה היום (כ-${Math.round(walkKm)} ק״מ) — שקלו מונית או מטרו` });
  const wxHit = out.filter(x => !x.done && x.warns.some(w => w.type === 'wx' && w.lvl !== 'lo')).length;
  if (wxHit) dayWarns.push({ lvl: 'mid', type: 'wx', text: wxHit === 1 ? 'פעילות אחת בחוץ בזמן מזג אוויר לא נוח, מסומנת למטה' : `${wxHit} פעילויות בחוץ בזמן מזג אוויר לא נוח, מסומנות למטה` });

  return {
    items: out, wd, sun, leave, end: cursor, back, activity, walkKm,
    warns: dayWarns,
    warnCount: dayWarns.length + out.reduce((n, x) => n + x.warns.filter(w => w.lvl !== 'lo').length, 0),
  };
}

// ---------- food ranking ----------

export function dietOk(f, diet) {
  if (diet === 'kosher-only') return !!f.kosher;
  if (diet === 'veg') return (f.veg || 0) >= 2;
  if (diet === 'kosher-veg') return !!f.kosher || (f.veg || 0) >= 2;
  return true;
}

const MEAL_TYPES = {
  lunch: new Set(['restaurant', 'trattoria', 'pizza', 'street', 'market', 'fine', 'wine', 'grocery']),
  dinner: new Set(['restaurant', 'trattoria', 'pizza', 'fine', 'wine']),
};

export function rankFood({ meal, near, wd, time, diet = 'kosher-veg', exclude = new Set(), area = null, areaUse = null }) {
  const out = [];
  for (const f of DB.food) {
    if (meal && MEAL_TYPES[meal]) {
      if (f.meals ? !f.meals.includes(meal) : !MEAL_TYPES[meal].has(f.type)) continue;
    }
    if (!dietOk(f, diet)) continue;
    let s = 0;
    if (time != null && wd != null) {
      const c = checkOpen(f, wd, time, time + 45);
      if (!c.ok && !(c.type === 'notyet' && c.at - time <= 30)) continue;
      if (!c.ok) s -= 15;
    }
    const km = near ? distKm(near, f) ?? 3 : 2;
    s -= km * 16;
    if (km > 1.8) s -= 10; // too far to walk: needs a taxi or the metro
    if (f.kosher && diet === 'kosher-veg') s += 25;
    if (areaUse) s -= (areaUse[f.area] || 0) * 3; // spread meals across neighbourhoods
    if (diet !== 'any') s += (f.veg || 0) * 5;
    if (f.top) s += 10;
    if (area && f.area === area) s += 5;
    if (exclude.has(f.id)) s -= 60;
    if (f.price >= 4) s -= 6;
    if (meal === 'dinner' && ['street', 'coffee', 'bakery', 'grocery'].includes(f.type)) s -= 15;
    if (meal === 'lunch' && ['coffee', 'bakery', 'grocery'].includes(f.type)) s -= 6;
    out.push({ f, s, km });
  }
  return out.sort((a, b) => b.s - a.s);
}

// Where a meal happens: the stop before it, else the stop after it (never the airport).
export function nearestLoc(items, idx) {
  const ok = x => x.loc && x.t !== 'fixed';
  for (let i = idx - 1; i >= 0; i--) if (ok(items[i])) return items[i].loc;
  for (let i = idx + 1; i < items.length; i++) if (ok(items[i])) return items[i].loc;
  return null;
}

// Food tours and cooking classes stand in for a meal rather than for sightseeing.
const isFoodExperience = e => e?.cat === 'experience' && (e.tags || []).includes('food');
const WHEN_NOT_BEFORE = { afternoon: toMin('14:00'), evening: toMin('17:30') };

export function usedFoodIds(state, exceptDate = null) {
  const s = new Set();
  for (const d of state.days || []) {
    if (d.date === exceptDate) continue;
    for (const it of d.items) if (it.t === 'food') s.add(it.id);
  }
  return s;
}

export function fillMeals(days, state, exclude = new Set()) {
  const used = new Set(exclude);
  const areaUse = {};
  for (const id of used) { const f = get(id); if (f) areaUse[f.area] = (areaUse[f.area] || 0) + 1; }
  for (const day of days) {
    const c = computeDay(day, state);
    c.items.forEach((ci, idx) => {
      const it = day.items[idx];
      if (!it.auto || (it.t !== 'meal' && it.t !== 'food')) return;
      if (it.t === 'food' && !it.refill) { used.add(it.id); return; }
      const near = nearestLoc(c.items, idx) || hotelOf(state) || TRIP.center;
      const best = rankFood({ meal: it.meal, near, wd: c.wd, time: ci.start, diet: state.settings.diet, exclude: used, area: it.area, areaUse })[0];
      if (best) {
        day.items[idx] = { u: it.u, t: 'food', id: best.f.id, meal: it.meal, auto: true, area: it.area };
        used.add(best.f.id);
        areaUse[best.f.area] = (areaUse[best.f.area] || 0) + 1;
      } else {
        day.items[idx] = { u: it.u, t: 'meal', meal: it.meal, auto: true, area: it.area };
      }
    });
  }
}

// ---------- building days from themes ----------

const promoted = (e, ints) =>
  (ints.art && (e.tags || []).includes('art')) ||
  (ints.shopping && e.cat === 'shopping') ||
  (ints.food && (e.tags || []).includes('food'));

function interestOk(e, ints, tier) {
  if (e.cat === 'shopping' && !ints.shopping) return false;
  if (e.cat === 'experience' && (e.tags || []).includes('food') && !ints.food) return false;
  if (!ints.art && e.cat === 'museum' && tier > 1) return false;
  return true;
}

function pinStart(e, state, wd, b) {
  let t = dayStartMin(state);
  const h = hoursFor(e, wd);
  if (h && h.length && t < h[0][0]) t = h[0][0];
  if (b.slots || e.slots) {
    const slot = (b.slots || e.slots).map(toMin).find(s => s >= t);
    if (slot != null) t = slot;
  }
  return fromMin(t);
}

function blockItem(b, e, state, date) {
  if (b.meal) return { u: uid(), t: 'meal', meal: b.meal, area: b.area || null, auto: true };
  const it = { u: uid(), t: e.kind === 'food' ? 'food' : 'place', id: e.id };
  if (e.kind === 'food') it.meal = b.as || 'snack';
  if (b.dur) it.dur = b.dur;
  if (b.pin === 'start') it.pin = pinStart(e, state, weekdayOf(date), b);
  else if (typeof b.pin === 'string' && b.pin.startsWith('sunset')) {
    // "sunset-35" = aim to arrive 35 minutes before sunset, without complaining if the day runs late.
    it.pin = fromMin(toMin(sunTimes(date).sunset) - Number(b.pin.slice(7) || 0));
    it.soft = true;
  } else if (b.pin) it.pin = b.pin;
  return it;
}

function buildThemeItems(theme, date, state) {
  const pace = paceOf(state);
  const wd = weekdayOf(date);
  const ints = state.settings.interests;
  // Interest-only blocks (e.g. a food tour) switch on with the interest and stand in for
  // the blocks they replace (e.g. the evening walk and dinner).
  const usable = b => {
    const e = get(b.p);
    return e && !closedOn(e, wd);
  };
  const active = theme.blocks.filter(b => b.needs && ints[b.needs] && usable(b));
  const replaced = new Set(active.flatMap(b => b.replaces || []));
  const cands = [];
  theme.blocks.forEach((b, i) => {
    if (b.needs && !active.includes(b)) return;
    if (replaced.has(b.p || b.meal)) return;
    if (b.meal) { cands.push({ i, b, meal: true }); return; }
    const e = get(b.p);
    if (!e || closedOn(e, wd)) return;
    let tier = b.tier || e.tier || 2;
    if (!interestOk(e, ints, tier)) return;
    const boost = tier >= 3 && promoted(e, ints);
    if (boost) tier = 2;
    cands.push({ i, b, e, tier, boost, dur: isFoodExperience(e) ? 0 : b.dur || e.dur || 60 });
  });
  const keep = new Set();
  let used = 0;
  for (const c of cands) {
    if (c.meal || c.tier === 1) { keep.add(c.i); used += c.meal ? 0 : c.dur; }
  }
  // Fill the remaining capacity tier by tier; within a tier the theme's own picks
  // come before items promoted by an interest, then by order in the day.
  for (const tier of [2, 3]) {
    if (tier > pace.maxTier) break;
    const pass = cands
      .filter(c => !c.meal && c.tier === tier && !keep.has(c.i))
      .sort((a, b) => (a.boost - b.boost) || (a.i - b.i));
    for (const c of pass) {
      if (used + c.dur <= pace.capacity) { keep.add(c.i); used += c.dur; }
    }
  }
  return cands.filter(c => keep.has(c.i)).map(c => {
    const it = blockItem(c.b, c.e, state, date);
    if (!c.meal) it.bt = c.tier;
    return it;
  });
}

// A generated lunch sits where the theme put it; on slow days that can drift to 17:00.
// Move it before the first stop that starts after midday.
function placeLunch(day, state) {
  const c = computeDay(day, state);
  const li = c.items.findIndex(x => x.meal === 'lunch' && x.auto);
  if (li < 0 || c.items[li].start <= toMin('14:15')) return;
  const k = c.items.findIndex((x, i) => i < li && x.t !== 'fixed' && !x.pin && x.start >= toMin('12:15'));
  if (k < 0) return;
  const [lunch] = day.items.splice(li, 1);
  day.items.splice(k, 0, lunch);
}

// Drop optional stops that the timing pushes outside their opening hours.
function pruneClosed(day, state) {
  for (let round = 0; round < 4; round++) {
    const c = computeDay(day, state);
    const bad = c.items.find(x => x.bt > 1 && !x.pin && x.warns.some(w => w.type === 'hours'));
    if (!bad) return;
    day.items = day.items.filter(x => x.u !== bad.u);
  }
}

// A viewpoint aimed at sunset is the point of the afternoon: if optional stops push it
// more than 20 minutes late, drop the least important of them.
function fitSunset(day, state) {
  for (let round = 0; round < 4; round++) {
    const c = computeDay(day, state);
    const target = c.items.find(x => x.soft && x.pin && x.start - toMin(x.pin) > 20);
    if (!target) return;
    const before = c.items.slice(0, c.items.indexOf(target)).filter(x => x.bt > 1 && !x.pin);
    if (!before.length) return;
    const victim = before.sort((a, b) => (b.bt - a.bt) || (b.dur - a.dur))[0];
    day.items = day.items.filter(x => x.u !== victim.u);
  }
}

function tidy(days, state) {
  for (const d of days) {
    if (d.theme === 'departure' || d.theme?.startsWith('daytrip:')) continue;
    placeLunch(d, state);
    pruneClosed(d, state);
    fitSunset(d, state);
  }
}

export function arrivalItems() {
  return [
    { u: uid(), t: 'fixed', kind: 'flight', title: 'נחיתה בפיומיצ׳ינו (FCO)', pin: TRIP.arrive.time, dur: 0 },
    { u: uid(), t: 'fixed', kind: 'airport', title: 'ביקורת גבולות (רישום ביומטרי EES) ומזוודות', dur: 70 },
    { u: uid(), t: 'fixed', kind: 'transfer', title: 'נסיעה למלון: מונית במחיר קבוע או Leonardo Express', dur: 50 },
    { u: uid(), t: 'fixed', kind: 'hotel', title: 'צ׳ק-אין או השארת מזוודות במלון', dur: 20 },
  ];
}

export function departureItems() {
  const flight = toMin(TRIP.depart.time);
  const atAirport = flight - 185; // Israeli airlines ask for 3 hours
  return [
    { u: uid(), t: 'fixed', kind: 'transfer', title: 'מונית מהמלון לשדה (מחיר קבוע €55, כ-45 דק׳)', pin: fromMin(atAirport - 50), dur: 45 },
    { u: uid(), t: 'fixed', kind: 'airport', title: 'צ׳ק-אין, בידוק ביטחוני וביקורת דרכונים', pin: fromMin(atAirport), dur: 150 },
    { u: uid(), t: 'fixed', kind: 'flight', title: 'המראה הביתה', pin: TRIP.depart.time, dur: 0 },
  ];
}

export function dayTripItems(trip) {
  return [
    { u: uid(), t: 'daytrip', id: trip.id, pin: trip.plan?.[0]?.t || '08:00' },
    { u: uid(), t: 'meal', meal: 'dinner', area: null, auto: true },
  ];
}

export function itemsForTheme(themeId, date, state) {
  if (themeId === 'departure') return departureItems();
  if (themeId?.startsWith('daytrip:')) {
    const trip = get(themeId.slice(8));
    return trip ? dayTripItems(trip) : [];
  }
  const theme = DB.themes[themeId];
  if (!theme) return [];
  const items = buildThemeItems(theme, date, state);
  return themeId === 'arrival' ? [...arrivalItems(), ...items] : items;
}

export function themeTitle(themeId) {
  if (!themeId) return 'יום חופשי';
  if (themeId === 'departure') return 'טיסה הביתה';
  if (themeId.startsWith('daytrip:')) return `טיול יום: ${get(themeId.slice(8))?.name || ''}`;
  return DB.themes[themeId]?.title || 'יום חופשי';
}

export function themeOptions(date, state) {
  const wd = weekdayOf(date);
  return Object.entries(DB.themes)
    .filter(([, t]) => t.kind === 'day')
    .map(([id, t]) => ({ id, t, blocked: (t.notOn || []).includes(wd) }));
}

export function bestDayForTrip(trip, taken = []) {
  const days = FULL_DAYS.filter(d => !taken.includes(d));
  const ok = days.filter(d => !(trip.closed || []).includes(weekdayOf(d)));
  const pref = ok.find(d => (trip.bestDays || []).includes(weekdayOf(d)));
  return pref || ok[0] || days[0];
}

export function assignThemes(state) {
  const s = state.settings;
  const fixed = {};
  const trip = s.interests.daytrip && s.dayTrip?.id ? get(s.dayTrip.id) : null;
  if (trip) {
    const date = FULL_DAYS.includes(s.dayTrip.date) ? s.dayTrip.date : bestDayForTrip(trip);
    fixed[date] = 'daytrip:' + trip.id;
  }
  const free = FULL_DAYS.filter(d => !fixed[d]);
  const cands = Object.entries(DB.themes)
    .filter(([, t]) => t.kind === 'day' && (!t.needs || s.interests[t.needs]))
    .map(([id, t]) => ({ id, t }));

  let best = null, bestScore = -Infinity;
  const walk = (i, used, acc, score) => {
    if (i === free.length) {
      if (score > bestScore) { bestScore = score; best = [...acc]; }
      return;
    }
    const wd = weekdayOf(free[i]);
    for (const c of cands) {
      if (used.has(c.id) || (c.t.notOn || []).includes(wd)) continue;
      used.add(c.id); acc.push(c.id);
      walk(i + 1, used, acc, score + (c.t.value || 50) + (c.t.pref?.[wd] || 0));
      acc.pop(); used.delete(c.id);
    }
  };
  walk(0, new Set(), [], 0);

  const map = { [TRIP.dates[0]]: 'arrival', [TRIP.dates[5]]: 'departure', ...fixed };
  free.forEach((d, i) => { map[d] = best?.[i] || null; });
  return map;
}

function insertBeforeDinner(day, item) {
  let at = day.items.length;
  for (let i = day.items.length - 1; i >= 0; i--) {
    if (day.items[i].meal === 'dinner') { at = i; break; }
  }
  day.items.splice(at, 0, item);
}

export function insertItem(day, item) {
  if (item.t === 'food' && (item.meal === 'lunch' || item.meal === 'dinner')) {
    const i = day.items.findIndex(x => (x.t === 'meal' || (x.t === 'food' && x.auto)) && x.meal === item.meal);
    if (i >= 0) { day.items[i] = { ...item, u: day.items[i].u }; return; }
  }
  if (item.meal === 'dinner') { day.items.push(item); return; }
  insertBeforeDinner(day, item);
}

function addFavorites(days, state) {
  const inPlan = new Set(days.flatMap(d => d.items.map(i => i.id)).filter(Boolean));
  const hotel = hotelOf(state);
  for (const id of state.favs) {
    const e = get(id);
    if (!e || e.kind !== 'place' || inPlan.has(id)) continue;
    let best = null;
    for (const d of days) {
      if (d.theme === 'departure' || d.theme?.startsWith('daytrip:')) continue;
      const wd = weekdayOf(d.date);
      if (closedOn(e, wd)) continue;
      if (e.days && !e.days.includes(d.date)) continue;
      const pts = d.items.map(i => locOf(i, i.id ? get(i.id) : null, hotel)).filter(Boolean);
      const c = centroid(pts);
      const km = c ? distKm(c, e) : 4;
      const load = d.items.filter(i => i.t === 'place').length;
      const score = -km - load * 0.4;
      if (!best || score > best.score) best = { d, score };
    }
    if (best) {
      insertBeforeDinner(best.d, { u: uid(), t: 'place', id, fav: true });
      inPlan.add(id);
    }
  }
}

// The final schedule from data/schedule.json, as plan days (each item gets a fresh id).
export function scheduleDays(dates = null) {
  const src = DB.schedule?.days || [];
  return TRIP.dates
    .filter(date => !dates || dates.includes(date))
    .map(date => {
      const d = src.find(x => x.date === date) || { date, title: 'יום חופשי', items: [] };
      const day = { date, theme: 'final', title: d.title, items: d.items.map(it => ({ ...JSON.parse(JSON.stringify(it)), u: uid() })) };
      if (d.noroute) day.noroute = true;
      return day;
    });
}

// After a time changes, put the stops back in time order. Stops without a fixed time
// stay right after the stop they followed.
export function sortByPins(day) {
  let key = -1;
  const keyed = day.items.map((it, i) => {
    const p = toMin(it.pin);
    key = p != null ? p : key + 0.001;
    return { it, k: key, i };
  });
  keyed.sort((a, b) => (a.k - b.k) || (a.i - b.i));
  day.items = keyed.map(x => x.it);
}

export function generatePlan(state) {
  const map = assignThemes(state);
  const days = TRIP.dates.map(date => ({ date, theme: map[date], items: itemsForTheme(map[date], date, state) }));
  addFavorites(days, state);
  tidy(days, state);
  fillMeals(days, state);
  return days;
}

export function rebuildDay(state, date, themeId) {
  const day = state.days.find(d => d.date === date);
  if (!day) return;
  day.theme = themeId;
  day.items = itemsForTheme(themeId, date, state);
  tidy([day], state);
  fillMeals([day], state, usedFoodIds(state, date));
}

// Average minutes per day spent getting from the hotel to the plan and back.
export function hotelCommute(hotel, state) {
  if (!hotel || !state.days) return null;
  let total = 0, n = 0;
  for (const d of state.days.slice(1, 5)) {
    if (d.theme?.startsWith('daytrip:')) {
      const l = leg(hotel, TRIP.termini);
      if (l) { total += l.min * 2; n++; }
      continue;
    }
    const pts = d.items.map(i => locOf(i, i.id ? get(i.id) : null, hotel)).filter(Boolean);
    if (!pts.length) continue;
    total += (leg(hotel, pts[0])?.min || 0) + (leg(pts[pts.length - 1], hotel)?.min || 0);
    n++;
  }
  return n ? Math.round(total / n) : null;
}
