import { routeStateAtTime, type RouteStateAtTime } from '../algorithms/routeWeather';
import { getProviders } from '../services/providers';
import { forecastLookupFn } from '../services/routePlanner';
import { deviceTimeZone } from '../utils/timezone';
import type { AppState } from './store';

let memo: { key: unknown[]; value: RouteStateAtTime | null } | null = null;

/**
 * Selector: route position + weather at the time chosen in "Where will I
 * be at…". Memoized so map and panel share one stable object.
 */
export function selectScrub(s: AppState): RouteStateAtTime | null {
  if (s.scrubMs === null || !s.plan) return null;
  const navigating = s.mode !== 'planning' && s.progress !== null;
  const nowMs = s.mode === 'simulating' ? s.sim.nowMs : Date.now();
  const clockKey = navigating ? Math.round(s.progress!.modelTimeS / 30) : s.derived.departureMs;
  const key = [s.plan, s.forecasts, s.scrubMs, s.mode, clockKey];
  if (memo && memo.key.length === key.length && memo.key.every((k, i) => k === key[i])) return memo.value;
  const value = routeStateAtTime({
    timed: s.plan.timed,
    samples: s.plan.samples,
    forecastFor: forecastLookupFn(getProviders(), s.forecasts),
    atMs: s.scrubMs,
    clock: navigating
      ? { mode: 'navigating', nowMs, modelTimeS: s.progress!.modelTimeS }
      : { mode: 'planning', departureMs: s.derived.departureMs },
    fallbackTimeZone: deviceTimeZone(),
  });
  memo = { key, value };
  return value;
}
