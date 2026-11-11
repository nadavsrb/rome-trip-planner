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
  byId: new Map(),
};

const FILES = ['places', 'food', 'hotels', 'daytrips', 'plan', 'info'];

export async function loadData() {
  const parts = await Promise.all(FILES.map(async f => {
    const res = await fetch(`data/${f}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`data/${f}.json: ${res.status}`);
    return res.json();
  }));
  const [places, food, hotels, daytrips, plan, info] = parts;

  DB.places = places.items.map(p => ({ ...p, kind: 'place' }));
  DB.food = food.items.map(f => ({ ...f, kind: 'food' }));
  DB.notes = food.notes || {};
  DB.hotels = hotels.items.map(h => ({ ...h, kind: 'hotel' }));
  DB.areas = hotels.areas || [];
  DB.daytrips = daytrips.items.map(d => ({ ...d, kind: 'daytrip', cat: 'daytrip' }));
  DB.themes = plan.themes;
  DB.info = info;

  DB.byId.clear();
  for (const e of [...DB.places, ...DB.food, ...DB.hotels, ...DB.daytrips]) DB.byId.set(e.id, e);
  return DB;
}

export const get = id => DB.byId.get(id);

// Short names for cards and filters; the hotel tab shows the long neighbourhood names.
export function areaName(id) {
  return AREAS_FALLBACK[id] || DB.areas.find(a => a.id === id)?.name || '';
}
