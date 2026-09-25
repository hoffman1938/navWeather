import { createRouteProjector } from '../algorithms/placesAlongRoute';
import { positionAtDistance, timeAtDistance } from '../algorithms/routeTiming';
import type { TimedRoute } from '../types/route';
import { sliceLine } from '../utils/distance';
import type { Poi, PoiCategory, PoiProvider } from './places/PoiProvider';
import type { RoutingProvider } from './routing/RoutingProvider';

export interface PoiResult {
  poi: Poi;
  distanceAlongM: number;
  offRouteM: number;
  /** Driving distance ahead of the vehicle to the point where you'd leave the route. */
  aheadM: number;
  /** Extra driving time vs staying on the route (s), from a real routing matrix. */
  detourS?: number;
  detourM?: number;
}

/**
 * "Places along my route" — not "places near me". Searches a corridor on the
 * route AHEAD, snaps results to the route, and computes the real detour
 * (leave route → place → rejoin) with the routing provider's travel matrix.
 */
export async function searchAlongRoute(args: {
  places: PoiProvider;
  routing: RoutingProvider;
  timed: TimedRoute;
  category: PoiCategory;
  fromM: number;
  aheadM: number;
  corridorM?: number;
  maxResults?: number;
  signal?: AbortSignal;
  language?: string;
}): Promise<PoiResult[]> {
  const { timed, fromM } = args;
  const corridorM = args.corridorM ?? 2000;
  const toM = Math.min(timed.totalDistM, fromM + args.aheadM);
  if (toM - fromM < 200) return [];
  let corridor = sliceLine(timed.route.geometry, timed.cumDistM, fromM, toM);
  const stride = Math.max(1, Math.ceil(corridor.length / 300));
  corridor = corridor.filter((_, i) => i % stride === 0 || i === corridor.length - 1);
  const pois = await args.places.search(args.category, corridor, { corridorM, signal: args.signal, language: args.language });

  const project = createRouteProjector(timed);
  const candidates: PoiResult[] = [];
  for (const poi of pois) {
    const p = project(poi.coordinate);
    if (p.distanceFromLineM > corridorM || p.distanceAlongM < fromM || p.distanceAlongM > toM) continue;
    candidates.push({ poi, distanceAlongM: p.distanceAlongM, offRouteM: p.distanceFromLineM, aheadM: p.distanceAlongM - fromM });
  }
  // Closest to the road first, then earliest; keep a handful for the detour matrix.
  candidates.sort((a, b) => a.offRouteM / 500 + a.aheadM / 10_000 - (b.offRouteM / 500 + b.aheadM / 10_000));
  const top = candidates.slice(0, args.maxResults ?? 8);

  if (top.length && args.routing.capabilities.matrix && args.routing.travelMatrix) {
    const A = top.map((c) => positionAtDistance(timed, Math.max(fromM, c.distanceAlongM - 1500)).coordinate);
    const B = top.map((c) => positionAtDistance(timed, Math.min(timed.totalDistM, c.distanceAlongM + 1500)).coordinate);
    const P = top.map((c) => c.poi.coordinate);
    try {
      const mx = await args.routing.travelMatrix([...A, ...P], [...P, ...B], args.signal);
      const n = top.length;
      top.forEach((c, i) => {
        const toPoi = mx.durations[i]?.[i];
        const back = mx.durations[n + i]?.[n + i];
        const aAlong = Math.max(fromM, c.distanceAlongM - 1500);
        const bAlong = Math.min(timed.totalDistM, c.distanceAlongM + 1500);
        const base = timeAtDistance(timed, bAlong) - timeAtDistance(timed, aAlong);
        if (toPoi != null && back != null) c.detourS = Math.max(0, toPoi + back - base);
        const dToPoi = mx.distances[i]?.[i];
        const dBack = mx.distances[n + i]?.[n + i];
        if (dToPoi != null && dBack != null) c.detourM = Math.max(0, dToPoi + dBack - (bAlong - aAlong));
      });
    } catch {
      // Detour unknown — results still useful, shown without "+N min".
    }
  }
  return top.sort((a, b) => a.aheadM - b.aheadM);
}

/** Pick the best result for a voice answer: soonest with an acceptable detour. */
export function bestPoi(results: PoiResult[], maxDetourMin?: number): PoiResult | undefined {
  const limit = (maxDetourMin ?? 8) * 60;
  const ok = results.filter((r) => r.detourS === undefined || r.detourS <= limit);
  const pool = ok.length ? ok : results;
  return [...pool].sort((a, b) => a.aheadM / 15 + (a.detourS ?? 0) * 2 - (b.aheadM / 15 + (b.detourS ?? 0) * 2))[0];
}
