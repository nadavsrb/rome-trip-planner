// Distances, walking estimates, sunrise/sunset and map links.
import { pad2 } from './util.js';

const R = 6371;
const rad = d => (d * Math.PI) / 180;

export function distKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Rome's streets wind, so a straight line understates the walk by ~30%.
const STREET_FACTOR = 1.3;
const WALK_KMH = 4.6;
const MAX_WALK_MIN = 30;

export function leg(a, b) {
  const straight = distKm(a, b);
  if (straight == null) return null;
  const km = straight * STREET_FACTOR;
  const walk = Math.max(1, Math.round((km / WALK_KMH) * 60));
  if (walk <= MAX_WALK_MIN) return { km, min: walk, mode: 'walk', walk };
  // Taxi or metro, including the wait and the walk to the stop.
  const ride = Math.round(12 + km * 2.6);
  return { km, min: Math.min(walk, ride), mode: 'ride', walk };
}

export function centroid(points) {
  const p = points.filter(x => x && x.lat != null);
  if (!p.length) return null;
  return { lat: p.reduce((s, x) => s + x.lat, 0) / p.length, lng: p.reduce((s, x) => s + x.lng, 0) / p.length };
}

// Sunrise equation (NOAA simplification); Rome is UTC+1 throughout November.
export function sunTimes(iso, lat = 41.8967, lng = 12.4822, tzMin = 60) {
  const jd = Date.parse(iso + 'T12:00:00Z') / 86400000 + 2440587.5;
  const n = Math.round(jd - 2451545.0 + 0.0008);
  const jStar = n - lng / 360;
  const M = (357.5291 + 0.98560028 * jStar) % 360;
  const Mr = rad(M);
  const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
  const lambda = rad((M + C + 180 + 102.9372) % 360);
  const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lambda);
  const decl = Math.asin(Math.sin(lambda) * Math.sin(rad(23.4397)));
  const cosH = (Math.sin(rad(-0.833)) - Math.sin(rad(lat)) * Math.sin(decl)) / (Math.cos(rad(lat)) * Math.cos(decl));
  const H = (Math.acos(cosH) * 180) / Math.PI;
  const clock = j => {
    const d = new Date((j - 2440587.5) * 86400000 + tzMin * 60000);
    return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  };
  return { sunrise: clock(jTransit - H / 360), sunset: clock(jTransit + H / 360) };
}

export const gmapsPlace = p => {
  const q = p.lat != null ? `${p.lat},${p.lng}` : `${p.orig || p.name} Roma`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
};

export function gmapsDir(to, from = null, mode = 'walking') {
  const d = `${to.lat},${to.lng}`;
  const o = from && from.lat != null ? `&origin=${from.lat},${from.lng}` : '';
  return `https://www.google.com/maps/dir/?api=1&destination=${d}${o}&travelmode=${mode}`;
}
