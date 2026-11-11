// Daily forecast for the trip dates from Open-Meteo (free, no key), cached for 3 hours.
import { TRIP } from './planner.js';

const KEY = 'rome26:wx';
const TTL = 3 * 3600 * 1000;
const URL = 'https://api.open-meteo.com/v1/forecast?latitude=41.8967&longitude=12.4822'
  + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset'
  + `&timezone=Europe%2FRome&start_date=${TRIP.dates[0]}&end_date=${TRIP.dates[5]}`;

// Mid-November normals for Rome, used until the forecast reaches the trip dates.
export const CLIMATE = { tmax: 17, tmin: 9, pop: 35, code: 3, normal: true };

export const wx = { byDate: {}, fetchedAt: 0 };

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

function parse(j) {
  const d = j.daily, byDate = {};
  d.time.forEach((date, i) => {
    byDate[date] = {
      code: d.weather_code[i],
      tmax: Math.round(d.temperature_2m_max[i]),
      tmin: Math.round(d.temperature_2m_min[i]),
      pop: d.precipitation_probability_max[i],
      sunrise: d.sunrise[i]?.slice(11, 16),
      sunset: d.sunset[i]?.slice(11, 16),
    };
  });
  return byDate;
}

export async function loadWeather() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (c && Date.now() - c.at < TTL) { wx.byDate = c.byDate; wx.fetchedAt = c.at; return wx; }
    if (c) { wx.byDate = c.byDate; wx.fetchedAt = c.at; }
  } catch { /* ignore */ }
  try {
    const res = await fetch(URL);
    if (!res.ok) throw new Error(res.status);
    wx.byDate = parse(await res.json());
    wx.fetchedAt = Date.now();
    try { localStorage.setItem(KEY, JSON.stringify({ at: wx.fetchedAt, byDate: wx.byDate })); } catch { /* ignore */ }
  } catch { /* offline or dates beyond the 16-day horizon */ }
  return wx;
}

export const dayWeather = date => wx.byDate[date] || null;
