// The phone's position, used for "near me" sorting and the map's locate button.
import { distKm } from '../geo.js';
import { TRIP } from '../planner.js';
import { toast } from '../ui.js';

export function myPosition({ quiet = false } = {}) {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      p => {
        const here = { lat: p.coords.latitude, lng: p.coords.longitude };
        if (distKm(here, TRIP.center) > 60) {
          if (!quiet) toast('אתם עוד לא ברומא 🙂 ממיינים לפי מרכז העיר');
          resolve(TRIP.center);
          return;
        }
        resolve(here);
      },
      () => { if (!quiet) toast('לא התקבל מיקום — בדקו הרשאות מיקום'); resolve(null); },
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 60000 },
    );
  });
}
