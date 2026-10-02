import type { Route } from '../types/route';
import { buildTimedRoute } from './routeTiming';
import { createRouteProjector } from './placesAlongRoute';

export interface DistinctRouteOptions {
  /** Most roads to keep, the best one included. */
  max: number;
  /** A road is a duplicate when more of it than this runs along a road already kept. */
  maxSharedFraction?: number;
  /** …or when less than this much of it is its own. */
  minUniqueM?: number;
  /** Roads this much slower than the best are not worth offering. */
  maxSlowerRatio?: number;
  /** "Along the same road" = within this many metres of it. */
  bufferM?: number;
}

const DEFAULTS = { maxSharedFraction: 0.9, minUniqueM: 1000, maxSlowerRatio: 1.75, bufferM: 120 };

/**
 * Share of `route`'s length (0–1) that runs along the road `reference` takes.
 * Samples the route at even distances, so long and short stretches weigh by length.
 */
export function sharedFraction(route: Route, reference: Route, bufferM = DEFAULTS.bufferM): number {
  const timed = buildTimedRoute(route);
  if (timed.totalDistM <= 0) return 1;
  const project = createRouteProjector(buildTimedRoute(reference));
  const steps = Math.max(20, Math.min(400, Math.round(timed.totalDistM / 150)));
  const geometry = route.geometry;
  let near = 0;
  let total = 0;
  let seg = 0;
  for (let i = 0; i <= steps; i++) {
    const d = (timed.totalDistM * i) / steps;
    while (seg < geometry.length - 2 && timed.cumDistM[seg + 1] < d) seg++;
    const span = timed.cumDistM[seg + 1] - timed.cumDistM[seg];
    const t = span > 0 ? Math.min(1, Math.max(0, (d - timed.cumDistM[seg]) / span)) : 0;
    const point: [number, number] = [
      geometry[seg][0] + (geometry[seg + 1][0] - geometry[seg][0]) * t,
      geometry[seg][1] + (geometry[seg + 1][1] - geometry[seg][1]) * t,
    ];
    total++;
    if (project(point).distanceFromLineM <= bufferM) near++;
  }
  return near / total;
}

/**
 * Roads worth choosing between. The router's best road always stays first;
 * the rest are dropped when they are the same road in all but a few metres
 * (routers love to return the best route twice, shifted onto a slip road) or
 * absurdly slower, then ordered fastest first and capped at `max`.
 */
export function selectDistinctRoutes(routes: Route[], options: DistinctRouteOptions): Route[] {
  if (routes.length <= 1) return routes.slice(0, Math.max(1, options.max));
  const [best, ...rest] = routes;
  return [best, ...otherDistinctRoutes(best, rest, { ...options, max: options.max - 1 })];
}

/**
 * The candidates that are really other roads than `reference` (and than each
 * other): fastest first, at most `max` of them. For roads offered next to
 * a road already chosen — e.g. after turning onto a new one while driving.
 */
export function otherDistinctRoutes(reference: Route, candidates: Route[], options: DistinctRouteOptions): Route[] {
  const { maxSharedFraction, minUniqueM, maxSlowerRatio, bufferM } = { ...DEFAULTS, ...options };
  const kept: Route[] = [];
  const eligible = candidates.filter((r) => r.durationS <= reference.durationS * maxSlowerRatio).sort((a, b) => a.durationS - b.durationS);
  for (const candidate of eligible) {
    if (kept.length >= options.max) break;
    const shared = Math.max(...[reference, ...kept].map((k) => sharedFraction(candidate, k, bufferM)));
    const uniqueM = (1 - shared) * candidate.distanceM;
    if (shared > maxSharedFraction || uniqueM < minUniqueM) continue;
    kept.push(candidate);
  }
  return kept;
}

/**
 * The roads a route mostly follows, longest first — "E60 · S12" — taken from
 * the turn-by-turn steps (a road number when it has one, else its name).
 * Roads that carry under 8 % of the trip are not worth naming it by.
 */
export function routeVia(route: Route, max = 2): string[] {
  const byRoad = new Map<string, number>();
  let total = 0;
  for (const leg of route.legs) {
    for (const step of leg.steps) {
      total += step.distanceM;
      const label = (step.ref?.split(';')[0] || step.name || '').trim();
      if (label) byRoad.set(label, (byRoad.get(label) ?? 0) + step.distanceM);
    }
  }
  return [...byRoad]
    .filter(([, m]) => m >= total * 0.08)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([label]) => label);
}
