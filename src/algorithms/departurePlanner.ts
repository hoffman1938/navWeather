import type { RouteSample } from '../types/route';
import type { LocationForecast, WeatherAtTime } from '../types/weather';
import { isPrecipitating, matchForecastToTime } from './weatherMatching';

/**
 * BEST TIME TO LEAVE — the same route driven at different departure times
 * meets different weather. For each candidate departure, every sample is
 * matched at its own ETA and the drive's exposure is summed (minutes of rain,
 * of severe weather, of fog), then weighted by how much each matters.
 */

export interface DepartureOption {
  departMs: number;
  arrivalMs: number;
  /** Minutes of the drive in any precipitation. */
  wetMinutes: number;
  /** Minutes in heavy rain, thunderstorms, snow or sleet. */
  severeMinutes: number;
  fogMinutes: number;
  /** Weighted exposure; lower is better. */
  score: number;
}

export interface DeparturePlan {
  options: DepartureOption[];
  best: DepartureOption;
  /** The option matching the currently chosen departure (nearest). */
  current: DepartureOption;
  /** A later/earlier departure worth suggesting, when the difference is real. */
  suggestion: DepartureOption | null;
}

const SLOT_MS = 30 * 60_000;

function severe(w: WeatherAtTime): boolean {
  return w.condition === 'HEAVY_RAIN' || w.condition === 'THUNDERSTORM' || w.condition === 'SNOW' || w.condition === 'SLEET' || (w.precipitation ?? 0) >= 4;
}

/** Exposure of one departure; null when the forecast doesn't cover the whole drive. */
export function exposureFor(
  samples: RouteSample[],
  forecastFor: (s: RouteSample) => LocationForecast | undefined,
  departMs: number,
): Omit<DepartureOption, 'departMs' | 'arrivalMs'> | null {
  let wet = 0;
  let sev = 0;
  let fog = 0;
  for (let i = 0; i < samples.length; i++) {
    const f = forecastFor(samples[i]);
    const w = f ? matchForecastToTime(f, departMs + samples[i].travelTimeS * 1000) : null;
    if (!w) return null;
    const next = samples[i + 1]?.travelTimeS ?? samples[i].travelTimeS;
    const prev = samples[i - 1]?.travelTimeS ?? samples[i].travelTimeS;
    const span = (next - prev) / 2 / 60;
    if (isPrecipitating(w.condition)) wet += span;
    if (severe(w)) sev += span;
    if (w.condition === 'FOG' || (w.visibility !== undefined && w.visibility < 1000)) fog += span;
  }
  return {
    wetMinutes: Math.round(wet),
    severeMinutes: Math.round(sev),
    fogMinutes: Math.round(fog),
    // Severe weather counts most; plain rain still counts; fog in between.
    score: Math.round(wet + 3 * sev + 1.5 * fog),
  };
}

/**
 * Departures every 30 min from `fromMs` for `hours`. Suggests another time
 * only when it clearly beats the chosen one (≥15 weighted minutes and ≥30 %
 * less), preferring the nearest such time.
 */
export function planDepartures(
  samples: RouteSample[],
  totalTimeS: number,
  forecastFor: (s: RouteSample) => LocationForecast | undefined,
  chosenDepartMs: number,
  fromMs: number,
  hours = 12,
): DeparturePlan | null {
  if (samples.length < 2) return null;
  const start = Math.ceil(fromMs / SLOT_MS) * SLOT_MS;
  const options: DepartureOption[] = [];
  for (let t = start; t <= start + hours * 3_600_000; t += SLOT_MS) {
    const e = exposureFor(samples, forecastFor, t);
    if (!e) break; // beyond the forecast horizon
    options.push({ departMs: t, arrivalMs: t + totalTimeS * 1000, ...e });
  }
  if (options.length < 3) return null;
  const current = options.reduce((a, b) => (Math.abs(b.departMs - chosenDepartMs) < Math.abs(a.departMs - chosenDepartMs) ? b : a));
  const best = options.reduce((a, b) => (b.score < a.score ? b : a));
  const better = options
    .filter((o) => current.score - o.score >= 15 && o.score <= current.score * 0.7)
    .sort((a, b) => Math.abs(a.departMs - current.departMs) - Math.abs(b.departMs - current.departMs));
  // Among the clearly better ones, take the best of those within an hour of the nearest.
  const near = better.length ? better.filter((o) => Math.abs(o.departMs - better[0].departMs) <= 3_600_000) : [];
  const suggestion = near.length ? near.reduce((a, b) => (b.score < a.score ? b : a)) : null;
  return { options, best, current, suggestion };
}
