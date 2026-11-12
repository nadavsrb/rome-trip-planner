// Loads the curated JSON data and indexes every entity by id.
import { AREAS_FALLBACK } from './util.js';

export const DB = {
  places: [],    // attractions, experiences, shopping, events
  food: [],
  hotels: [],
  areas: [],
  daytrips: [],
  themes: {},
  info: {},
  notes: {},
  schedule: null, // our final day-by-day plan (data/schedule.json)
  stamp: null,    // when the loaded data was published (Last-Modified of schedule.json)
  byId: new Map(),
};

const FILES = ['places', 'food', 'hotels', 'daytrips', 'plan', 'info', 'ours', 'schedule'];

export async function loadData() {
  const parts = await Promise.all(FILES.map(async f => {
    const res = await fetch(`data/${f}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`data/${f}.json: ${res.status}`);
    if (f === 'schedule') DB.stamp = res.headers.get('last-modified');
    return res.json();
  }));
  const [places, food, hotels, daytrips, plan, info, ours, schedule] = parts;

  // Our own places (from the couple's map) sit next to the curated ones in every list.
  const ourFood = ours.items.filter(x => x.kind === 'food');
  const ourPlaces = ours.items.filter(x => x.kind === 'place');
  DB.places = [...ourPlaces, ...places.items].map(p => ({ ...p, kind: 'place' }));
  DB.food = [...ourFood, ...food.items].map(f => ({ ...f, kind: 'food' }));
  DB.notes = food.notes || {};
  DB.hotels = hotels.items.map(h => ({ ...h, kind: 'hotel' }));
  DB.areas = hotels.areas || [];
  DB.daytrips = daytrips.items.map(d => ({ ...d, kind: 'daytrip', cat: 'daytrip' }));
  DB.themes = plan.themes;
  DB.info = info;
  DB.schedule = schedule;

  DB.byId.clear();
  for (const e of [...DB.places, ...DB.food, ...DB.hotels, ...DB.daytrips]) {
    if (!DB.byId.has(e.id)) DB.byId.set(e.id, e);
  }
  // Small corrections to curated entries (icons, winter hours).
  for (const [id, o] of Object.entries(ours.overrides || {})) {
    const e = DB.byId.get(id);
    if (e) Object.assign(e, o);
  }
  // Pictures (data/images.json): optional, the app works without them.
  try {
    const res = await fetch('data/images.json', { cache: 'no-cache' });
    const pics = res.ok ? await res.json() : {};
    for (const [id, img] of Object.entries(pics)) {
      const e = DB.byId.get(id);
      if (e) e.img = img;
    }
  } catch { /* no pictures */ }
  // Anything the final schedule uses counts as one of ours too.
  for (const d of schedule.days) {
    for (const it of d.items) {
      for (const id of [it.id, ...(it.alts || [])]) {
        const e = id && DB.byId.get(id);
        if (e) e.ours = true;
      }
    }
  }
  return DB;
}

export const get = id => DB.byId.get(id);

// Short names for cards and filters; the hotel tab shows the long neighbourhood names.
export function areaName(id) {
  return AREAS_FALLBACK[id] || DB.areas.find(a => a.id === id)?.name || '';
}
