import type { RouteSample, TimedRoute } from '../types/route';
import type { LocationForecast } from '../types/weather';
import { lowerIndex } from '../utils/distance';
import { exposureFor } from './departurePlanner';
import { createRouteProjector } from './placesAlongRoute';

/**
 * WEATHER REROUTE — while driving, when the rest of the route runs into
 * severe weather (at the times you'd be there), compare it with the routes
 * available from where the car is now. An alternative is only *offered*
 * (never taken automatically), and only when it is clearly better for a
 * reasonable extra time.
 */

export interface Exposure {
  wetMinutes: number;
  severeMinutes: number;
  fogMinutes: number;
  score: number;
}

/** Worth looking for another route: some severe weather or real fog ahead. */
export function worthChecking(e: Exposure | null): boolean {
  return !!e && (e.severeMinutes >= 5 || e.fogMinutes >= 10);
}

/** The route's samples still ahead, re-timed from the vehicle. */
export function remainingSamples(samples: RouteSample[], progressM: number, progressTimeS: number): RouteSample[] {
  return samples.filter((s) => s.distanceM >= progressM).map((s) => ({ ...s, travelTimeS: Math.max(0, s.travelTimeS - progressTimeS) }));
}

export function exposureOf(samples: RouteSample[], forecastFor: (s: RouteSample) => LocationForecast | undefined, departMs: number): Exposure | null {
  return samples.length >= 2 ? exposureFor(samples, forecastFor, departMs) : null;
}

export interface RerouteChoice {
  /** Index into the candidates. */
  index: number;
  /** Extra driving time vs staying on the current route (s; may be negative). */
  extraS: number;
  current: Exposure;
  alternative: Exposure;
}

/**
 * The best clearly-better candidate: ≥15 weighted minutes and ≥40 % less
 * exposure, no more severe minutes, and at most max(20 min, 30 % of the
 * remaining time) longer.
 */
export function pickWeatherReroute(
  current: Exposure,
  remainingS: number,
  candidates: { exposure: Exposure | null; durationS: number }[],
): RerouteChoice | null {
  const maxExtra = Math.max(20 * 60, remainingS * 0.3);
  let best: RerouteChoice | null = null;
  candidates.forEach((c, index) => {
    const e = c.exposure;
    if (!e) return;
    const extraS = c.durationS - remainingS;
    if (extraS > maxExtra) return;
    if (current.score - e.score < 15 || e.score > current.score * 0.6) return;
    if (e.severeMinutes > current.severeMinutes) return;
    // Prefer less exposure; on a tie, less time.
    if (!best || e.score < best.alternative.score || (e.score === best.alternative.score && extraS < best.extraS)) {
      best = { index, extraS, current, alternative: e };
    }
  });
  return best;
}

/**
 * Forecast lookup for a candidate route: where it runs along the current
 * route (≤60 m), use the forecast of the current route's nearest sample, so
 * shared road is scored identically and only the parts that differ count.
 */
export function sharedForecastFor(
  current: TimedRoute,
  currentSamples: RouteSample[],
  currentFor: (s: RouteSample) => LocationForecast | undefined,
  fallback: (s: RouteSample) => LocationForecast | undefined,
): (s: RouteSample) => LocationForecast | undefined {
  const project = createRouteProjector(current);
  const sorted = [...currentSamples].sort((a, b) => a.distanceM - b.distanceM);
  const dists = sorted.map((x) => x.distanceM);
  return (smp) => {
    if (sorted.length) {
      const p = project(smp.coordinate);
      if (p.distanceFromLineM <= 60) {
        const i = lowerIndex(dists, p.distanceAlongM);
        const j = Math.min(sorted.length - 1, i + 1);
        const near = Math.abs(dists[j] - p.distanceAlongM) < Math.abs(dists[i] - p.distanceAlongM) ? sorted[j] : sorted[i];
        const f = currentFor(near);
        if (f) return f;
      }
    }
    return fallback(smp);
  };
}
