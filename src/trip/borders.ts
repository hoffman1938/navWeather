import type { LngLat } from '../types/geo';

/**
 * BORDER CROSSINGS — types and the API contract of `/api/v1/trips/borders`. The countries themselves come from
 * Natural Earth boundaries on the device and in the Worker (`trip/countries.ts`, DP-4.5) — no Overpass. Points at
 * sea or outside any country have no country and are skipped, so a ferry leg doesn't count as a border.
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

/** Most points one `/api/v1/trips/borders` request may ask about (the API contract of v1). */
export const MAX_BORDER_POINTS = 20;

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
