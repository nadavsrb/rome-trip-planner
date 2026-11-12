// Forecast for the trip dates: Open-Meteo (daily and hourly, free, no key), with MET Norway
// as a fallback. Cached for an hour and refreshed when the app comes back to the foreground.
import { TRIP } from './planner.js';

const KEY = 'rome26:wx2';
const TTL = 60 * 60 * 1000;
// Built when needed: planner.js imports this module, so TRIP isn't ready at load time.
const openMeteoUrl = () => 'https://api.open-meteo.com/v1/forecast?latitude=41.8967&longitude=12.4822'
  + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_gusts_10m_max,sunrise,sunset'
  + '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_gusts_10m,cloud_cover'
  + `&timezone=Europe%2FRome&start_date=${TRIP.dates[0]}&end_date=${TRIP.dates[5]}`;
const MET_NO = 'https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=41.897&lon=12.482';

// Mid-November normals for Rome, used when there's no forecast at all.
export const CLIMATE = { tmax: 17, tmin: 9, pop: 35, code: 3, normal: true };

// byDate: daily summary; hours: date → 24 slots { t, pop, mm, code, gust, cloud } (pop may be null).
export const wx = { byDate: {}, hours: {}, fetchedAt: 0, source: '' };

export function wxIcon(code) {
  if (code == null) return '🌤️';
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 57) return '🌦️';
  if (code <= 67) return '🌧️';
  if (code <= 77) return '🌨️';
  if (code <= 82) return '🌦️';
  return '⛈️';
}

export function wxText(code) {
  if (code == null) return '';
  if (code === 0) return 'בהיר';
  if (code <= 2) return 'מעונן חלקית';
  if (code === 3) return 'מעונן';
  if (code <= 48) return 'ערפל';
  if (code <= 57) return 'טפטוף';
  if (code <= 67) return 'גשם';
  if (code <= 77) return 'שלג';
  if (code <= 82) return 'ממטרים';
  return 'סופות רעמים';
}

const round = n => (n == null ? null : Math.round(n));

function parseOpenMeteo(j) {
  const d = j.daily, h = j.hourly, byDate = {}, hours = {};
  d.time.forEach((date, i) => {
    byDate[date] = {
      code: d.weather_code[i],
      tmax: round(d.temperature_2m_max[i]),
      tmin: round(d.temperature_2m_min[i]),
      pop: d.precipitation_probability_max[i],
      mm: d.precipitation_sum?.[i] ?? null,
      gust: round(d.wind_gusts_10m_max?.[i]),
      sunrise: d.sunrise[i]?.slice(11, 16),
      sunset: d.sunset[i]?.slice(11, 16),
    };
  });
  (h?.time || []).forEach((t, i) => {
    const date = t.slice(0, 10), hr = +t.slice(11, 13);
    (hours[date] ||= [])[hr] = {
      t: round(h.temperature_2m[i]), pop: h.precipitation_probability[i], mm: h.precipitation[i],
      code: h.weather_code[i], gust: round(h.wind_gusts_10m[i]), cloud: h.cloud_cover[i],
    };
  });
  return { byDate, hours };
}

// MET Norway symbols → the WMO codes the rest of the app speaks.
function metCode(sym = '') {
  if (sym.includes('thunder')) return 95;
  if (sym.includes('snow')) return 73;
  if (sym.includes('sleet')) return 67;
  if (sym.startsWith('heavyrain')) return sym.includes('showers') ? 82 : 65;
  if (sym.startsWith('lightrain')) return sym.includes('showers') ? 80 : 61;
  if (sym.startsWith('rain')) return sym.includes('showers') ? 81 : 63;
  if (sym.startsWith('fog')) return 45;
  if (sym.startsWith('cloudy')) return 3;
  if (sym.startsWith('partlycloudy')) return 2;
  if (sym.startsWith('fair')) return 1;
  return 0;
}

const romeParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
function romeDateHour(ms) {
  const p = Object.fromEntries(romeParts.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return [`${p.year}-${p.month}-${p.day}`, +p.hour];
}

function parseMetNo(j) {
  const hours = {};
  for (const p of j.properties.timeseries) {
    const inst = p.data.instant.details;
    const block = p.data.next_1_hours ? [1, p.data.next_1_hours] : p.data.next_6_hours ? [6, p.data.next_6_hours] : null;
    if (!block) continue;
    const [n, b] = block;
    for (let k = 0; k < n; k++) {
      const [date, hr] = romeDateHour(Date.parse(p.time) + k * 3600 * 1000);
      if (n === 6 && hours[date]?.[hr]) continue; // keep the hourly detail where both exist
      (hours[date] ||= [])[hr] = {
        t: round(inst.air_temperature), pop: null, mm: (b.details?.precipitation_amount || 0) / n,
        code: metCode(b.summary?.symbol_code), gust: round((inst.wind_speed_of_gust ?? inst.wind_speed * 1.3) * 3.6), cloud: round(inst.cloud_area_fraction),
      };
    }
  }
  const byDate = {};
  for (const [date, hs] of Object.entries(hours)) {
    const all = hs.filter(Boolean);
    const day = hs.slice(7, 23).filter(Boolean);
    if (!all.length) continue;
    byDate[date] = {
      code: Math.max(...(day.length ? day : all).map(x => x.code)),
      tmax: Math.max(...all.map(x => x.t)),
      tmin: Math.min(...all.map(x => x.t)),
      pop: null,
      mm: Math.round(all.reduce((s, x) => s + x.mm, 0) * 10) / 10,
      gust: Math.max(...all.map(x => x.gust)),
    };
  }
  return { byDate, hours };
}

function keep(parsed, source) {
  wx.byDate = parsed.byDate;
  wx.hours = parsed.hours;
  wx.fetchedAt = Date.now();
  wx.source = source;
  try { localStorage.setItem(KEY, JSON.stringify({ at: wx.fetchedAt, source, byDate: wx.byDate, hours: wx.hours })); } catch { /* ignore */ }
}

let inflight = null;
export function loadWeather({ force = false } = {}) {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (c && !wx.fetchedAt) Object.assign(wx, { byDate: c.byDate, hours: c.hours || {}, fetchedAt: c.at, source: c.source || '' });
  } catch { /* ignore */ }
  if (!force && wx.fetchedAt && Date.now() - wx.fetchedAt < TTL) return Promise.resolve(wx);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(openMeteoUrl(), { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      keep(parseOpenMeteo(await res.json()), 'Open-Meteo');
    } catch {
      try {
        const res = await fetch(MET_NO, { cache: 'no-store' });
        if (!res.ok) throw new Error(res.status);
        keep(parseMetNo(await res.json()), 'MET Norway');
      } catch { /* offline: keep what we have */ }
    }
    inflight = null;
    return wx;
  })();
  return inflight;
}

export const weatherIsStale = () => !wx.fetchedAt || Date.now() - wx.fetchedAt > TTL;

export const dayWeather = date => wx.byDate[date] || null;
export const hourWeather = (date, hr) => wx.hours[date]?.[hr] || null;

// The weather while something happens: worst code, highest rain chance and gusts, total rain.
export function windowWx(date, startMin, endMin) {
  const hs = wx.hours[date];
  if (!hs) return null;
  const from = Math.max(0, Math.floor(startMin / 60));
  const to = Math.min(23, Math.max(from, Math.ceil(endMin / 60) - 1));
  let any = false, code = 0, pop = null, mm = 0, gust = 0, tmin = 99, cloud = 0, n = 0;
  for (let h = from; h <= to; h++) {
    const x = hs[h];
    if (!x) continue;
    any = true;
    const overlap = Math.min(endMin, (h + 1) * 60) - Math.max(startMin, h * 60);
    const part = endMin > startMin ? Math.max(0, Math.min(1, overlap / 60)) : 1;
    code = Math.max(code, x.code ?? 0);
    if (x.pop != null) pop = Math.max(pop ?? 0, x.pop);
    mm += (x.mm || 0) * part;
    gust = Math.max(gust, x.gust || 0);
    tmin = Math.min(tmin, x.t ?? 99);
    cloud += x.cloud ?? 0; n++;
  }
  if (!any) return null;
  return { code, pop, mm: Math.round(mm * 10) / 10, gust, tmin, cloud: n ? Math.round(cloud / n) : null };
}

// How wet an hour or a window is: 0 dry, 1 maybe, 2 likely, 3 heavy.
export function wetness(w) {
  if (!w) return 0;
  const pop = w.pop ?? (w.mm >= 0.5 ? 75 : w.mm >= 0.2 ? 55 : w.mm > 0.05 ? 30 : 0);
  if (w.code >= 95 || pop >= 70 && w.mm >= 1 || w.mm >= 2) return 3;
  if (pop >= 50 || w.mm >= 0.5) return 2;
  if (pop >= 30 || w.mm >= 0.2) return 1;
  return 0;
}

// Hours of the day (7:00–24:00) when rain is likely, as [from, to) spans.
export function rainSpans(date) {
  const hs = wx.hours[date];
  if (!hs) return [];
  const spans = [];
  for (let h = 7; h < 24; h++) {
    if (wetness(hs[h]) < 2) continue;
    const last = spans[spans.length - 1];
    if (last && last[1] === h) last[1] = h + 1; else spans.push([h, h + 1]);
  }
  return spans;
}
