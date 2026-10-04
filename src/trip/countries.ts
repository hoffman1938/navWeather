import type { LngLat } from '../types/geo';
import type { BorderCrossing, BordersResponse, CountryRef } from './borders';

/**
 * COUNTRIES FROM OPEN DATA (DEVELOPMENT_PLAN DP-4.5): which country a point is in, from Natural Earth admin-0
 * boundaries (public domain) built by `pipelines/borders/build.mjs` into `trip/data/countries-v1.json`. No network:
 * the client finds the borders on its own route (offline too), and the Worker's `/api/v1/trips/borders` answers
 * from the same file — no Overpass, no edge cache (B-22).
 */

/** The file `pipelines/borders/build.mjs` writes: rings as delta-encoded integers in 1/q degrees. */
export interface CountriesFile {
  v: 1;
  source: string;
  builtAt: string;
  q: number;
  countries: { c: string; en: string; ru: string; b: [number, number, number, number]; p: number[][][] }[];
}

interface Country {
  code: string;
  en: string;
  ru: string;
  bbox: [number, number, number, number];
  /** Polygons → rings (the first is the outer one) → [x0, y0, x1, y1, …] in degrees. */
  polygons: Float64Array[][];
}

export interface CountryIndex {
  countries: Country[];
  source: string;
}

export function decodeCountries(file: CountriesFile): CountryIndex {
  const countries = file.countries.map((c) => ({
    code: c.c,
    en: c.en,
    ru: c.ru,
    bbox: c.b,
    polygons: c.p.map((poly) =>
      poly.map((ring) => {
        const out = new Float64Array(ring.length);
        let x = 0;
        let y = 0;
        for (let i = 0; i < ring.length; i += 2) {
          x += ring[i];
          y += ring[i + 1];
          out[i] = x / file.q;
          out[i + 1] = y / file.q;
        }
        return out;
      }),
    ),
  }));
  return { countries, source: file.source };
}

/** Even–odd ray casting on a flat ring. */
function inRing(ring: Float64Array, x: number, y: number): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = ring[i];
    const yi = ring[i + 1];
    const xj = ring[j];
    const yj = ring[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The country a point is in; null at sea or outside every country (e.g. Antarctica's ice shelves at this scale). */
export function countryAt(index: CountryIndex, [x, y]: LngLat, locale = 'en'): CountryRef | null {
  // A small margin: the bbox comes from the unsimplified source, the rings are simplified.
  const m = 0.05;
  for (const c of index.countries) {
    const [w, s, e, n] = c.bbox;
    if (x < w - m || x > e + m || y < s - m || y > n + m) continue;
    for (const [outer, ...holes] of c.polygons) {
      if (inRing(outer, x, y) && !holes.some((h) => inRing(h, x, y))) return { code: c.code, name: locale === 'ru' ? c.ru : c.en };
    }
  }
  return null;
}

const key = (c: CountryRef) => c.code || c.name;

/**
 * Countries along a route and where they change. Points every `stepM`; each change is placed between the last
 * point in one country and the first in the next by bisection on the route (to within ~stepM / 256). Points
 * without a country (sea, a gap at this scale) are skipped, so a ferry leg is not a border.
 */
export function countriesAlong(
  index: CountryIndex,
  pointAt: (alongM: number) => LngLat,
  totalDistM: number,
  locale = 'en',
  stepM = 5000,
): BordersResponse & { alongM: number[] } {
  const n = Math.max(1, Math.min(2000, Math.ceil(totalDistM / stepM)));
  const alongM = Array.from({ length: n + 1 }, (_, i) => Math.round((totalDistM * i) / n));
  const countries = alongM.map((d) => countryAt(index, pointAt(d), locale));
  const crossings: BorderCrossing[] = [];
  let last: { c: CountryRef; at: number } | null = null;
  countries.forEach((c, i) => {
    if (!c) return;
    if (last && key(last.c) !== key(c)) {
      let [lo, hi] = [last.at, alongM[i]];
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) / 2;
        const here = countryAt(index, pointAt(mid), locale);
        if (here && key(here) === key(last.c)) lo = mid;
        else hi = mid;
      }
      crossings.push({ alongM: Math.round((lo + hi) / 2), from: last.c, to: c });
    }
    last = { c, at: alongM[i] };
  });
  return { countries, crossings, alongM };
}
