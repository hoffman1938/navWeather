import type { LngLat } from '../types/geo';

/**
 * BORDER CROSSINGS — which country each of a few dozen points along the
 * route is in (OpenStreetMap country areas via one Overpass `is_in` query),
 * and where the country changes. Points at sea or outside any mapped country
 * have no country and are skipped, so a ferry leg doesn't count as a border.
 * Crossing positions are approximate (between two sampled points).
 */

export interface CountryRef {
  /** ISO 3166-1 alpha-2, when OSM has it. */
  code: string;
  name: string;
}

export interface BorderCrossing {
  /** Approximate along-route position of the border (m). */
  alongM: number;
  from: CountryRef;
  to: CountryRef;
}

export interface BordersRequest {
  version: 1;
  /** Points along the route, in order. */
  points: LngLat[];
  /** Along-route position of each point (m). */
  alongM: number[];
  locale?: string;
}

export interface BordersResponse {
  countries: (CountryRef | null)[];
  crossings: BorderCrossing[];
}

/** 20 points answer in ~6 s on the public Overpass; 40 timed out (2026-10-02). */
export const MAX_BORDER_POINTS = 20;

/** Points at least 25 km apart (at most MAX_BORDER_POINTS) along a route, ends included. */
export function borderSamplePoints(totalDistM: number, pointAt: (alongM: number) => LngLat): { points: LngLat[]; alongM: number[] } {
  const n = Math.max(1, Math.min(MAX_BORDER_POINTS - 1, Math.ceil(totalDistM / 25_000)));
  const step = Math.max(25_000, totalDistM / n);
  const alongM: number[] = [];
  for (let i = 0; i * step < totalDistM - 1 && alongM.length < MAX_BORDER_POINTS - 1; i++) alongM.push(Math.round(i * step));
  alongM.push(Math.round(totalDistM));
  return { points: alongM.map(pointAt), alongM };
}

/** One query: a marker element before each point's country, so points without a country stay aligned. */
export function bordersQuery(points: LngLat[]): string {
  const parts = points.map(
    ([lon, lat], i) => `make p ref="${i}";out;is_in(${lat.toFixed(5)},${lon.toFixed(5)})->.a;area.a["admin_level"="2"]["boundary"="administrative"];out tags;`,
  );
  return `[out:json][timeout:25];${parts.join('')}`;
}

interface Element {
  type: string;
  tags?: Record<string, string>;
}

export function parseBorders(data: { elements?: Element[] }, count: number, locale = 'en'): (CountryRef | null)[] {
  const out: (CountryRef | null)[] = new Array(count).fill(null);
  let current = -1;
  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    if (el.type === 'p') {
      const i = Number(tags.ref);
      current = Number.isInteger(i) && i >= 0 && i < count ? i : -1;
      continue;
    }
    if (current < 0 || out[current]) continue;
    const name = tags[`name:${locale}`] || tags['name:en'] || tags.name;
    if (!name) continue;
    out[current] = { code: tags['ISO3166-1'] || tags['ISO3166-1:alpha2'] || '', name };
  }
  return out;
}

/** Country changes along the route (points without a country are skipped). */
export function crossingsFrom(countries: (CountryRef | null)[], alongM: number[]): BorderCrossing[] {
  const out: BorderCrossing[] = [];
  let last: { c: CountryRef; at: number } | null = null;
  countries.forEach((c, i) => {
    if (!c) return;
    const key = (x: CountryRef) => x.code || x.name;
    if (last && key(last.c) !== key(c)) out.push({ alongM: Math.round((last.at + alongM[i]) / 2), from: last.c, to: c });
    last = { c, at: alongM[i] };
  });
  return out;
}

const isNum = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

export function sanitizeBordersRequest(raw: unknown): BordersRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || !Array.isArray(r.points) || !Array.isArray(r.alongM)) return null;
  if (r.points.length < 2 || r.points.length > MAX_BORDER_POINTS || r.points.length !== r.alongM.length) return null;
  const points: LngLat[] = [];
  for (const p of r.points) {
    if (!Array.isArray(p) || p.length !== 2 || !isNum(p[0], -180, 180) || !isNum(p[1], -90, 90)) return null;
    points.push([p[0], p[1]]);
  }
  if (!r.alongM.every((m) => isNum(m, 0, 25_000_000))) return null;
  return { version: 1, points, alongM: r.alongM as number[], locale: r.locale === 'ru' ? 'ru' : 'en' };
}
