import type { HazardKind, TripWeatherSample } from '../types';

/**
 * Hourly hazard codes exchanged between client and planner (compact: one
 * small integer per hour per route sample). The client derives them from the
 * forecasts it already has; the planner never calls a weather API.
 */
export const HAZARD_CODES: Record<number, HazardKind | null> = {
  0: null,
  1: 'rain',
  2: 'heavy-rain',
  3: 'snow',
  4: 'storm',
  5: 'fog',
  6: 'wind',
  7: 'freezing',
};

export const HIGH_HAZARDS: ReadonlySet<HazardKind> = new Set(['heavy-rain', 'snow', 'storm', 'freezing']);

export function severityOf(kind: HazardKind | null): 0 | 1 | 2 {
  if (!kind) return 0;
  return HIGH_HAZARDS.has(kind) ? 2 : 1;
}

/** Hour code at a time, or −1 when the forecast doesn't cover it. */
export function codeAt(sample: TripWeatherSample, atMs: number): number {
  const i = Math.floor((atMs - sample.t0) / 3_600_000);
  return i >= 0 && i < sample.h.length ? sample.h[i] : -1;
}

/** Inputs for `hazardCode` — one forecast hour, in the app's normalised units. */
export interface HourValues {
  condition: string | null;
  precipitation: number | null;
  temperature: number | null;
  windGusts: number | null;
  visibility: number | null;
}

/**
 * One forecast hour → the most severe hazard code. Same thresholds as the
 * alert engine: heavy = HEAVY_RAIN/THUNDERSTORM or ≥4 mm/h; fog = FOG or
 * visibility < 1 km; wind = gusts ≥ 70 km/h; freezing = ≤ 0.5 °C with
 * precipitation.
 */
export function hazardCode(v: HourValues): number {
  const c = v.condition;
  if (c === null && v.precipitation === null && v.temperature === null) return -1;
  const wet = (v.precipitation ?? 0) > 0.1 || c === 'RAIN' || c === 'HEAVY_RAIN' || c === 'SNOW' || c === 'SLEET' || c === 'THUNDERSTORM';
  if (c === 'THUNDERSTORM') return 4;
  if (wet && v.temperature !== null && v.temperature <= 0.5 && c !== 'SNOW') return 7;
  if (c === 'SNOW' || c === 'SLEET') return 3;
  if (c === 'HEAVY_RAIN' || (v.precipitation ?? 0) >= 4) return 2;
  if (c === 'FOG' || (v.visibility !== null && v.visibility < 1000)) return 5;
  if ((v.windGusts ?? 0) >= 70) return 6;
  if (c === 'RAIN' || (v.precipitation ?? 0) >= 0.3) return 1;
  return 0;
}
