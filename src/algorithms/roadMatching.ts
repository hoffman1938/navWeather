import type { LngLat } from '../types/geo';
import type { TimedRoute } from '../types/route';
import { bearingDeg, bearingDelta, pointAtDistance } from '../utils/distance';
import { createRouteProjector } from './placesAlongRoute';

/**
 * ROAD MATCHING while driving. The app knows several roads to the
 * destination (the ones offered when the trip was planned, or the ones found
 * after the last re-route). These answer two questions without a network call:
 *   - the driver left the road they were on — are they on ANOTHER road we know?
 *   - which of the other roads can the driver still take from here?
 */

type Projector = ReturnType<typeof createRouteProjector>;
const projectors = new WeakMap<TimedRoute, Projector>();

/** One projector per route (building it decimates the geometry), shared by everything below. */
export function projectorFor(timed: TimedRoute): Projector {
  let p = projectors.get(timed);
  if (!p) {
    p = createRouteProjector(timed);
    projectors.set(timed, p);
  }
  return p;
}

/** A road is "still there to take" while the car is this close to it (m). */
export const REACHABLE_ROAD_M = 60;

export interface RoadFix {
  coordinate: LngLat;
  headingDeg?: number;
  accuracyM?: number;
}

export interface RoadMatch {
  /** Index into the roads passed in. */
  index: number;
  distanceAlongM: number;
  distanceFromRoadM: number;
}

/**
 * How close the car must be to a road to be on it: tighter than the
 * off-route tolerance, because two roads can run side by side.
 */
export function onRoadThresholdM(accuracyM = 20): number {
  return Math.min(REACHABLE_ROAD_M, Math.max(30, 25 + Math.max(0, accuracyM) * 0.75));
}

/**
 * The known road the car is driving on: the nearest one within reach whose
 * direction agrees with the car's heading. Without a heading (the car is
 * stopped) nothing matches — the caller then plans a new route instead.
 */
export function matchKnownRoad(
  roads: TimedRoute[],
  fix: RoadFix,
  options: { except?: number; maxHeadingDeltaDeg?: number } = {},
): RoadMatch | null {
  const { headingDeg } = fix;
  if (headingDeg === undefined || !Number.isFinite(headingDeg)) return null;
  const maxDelta = options.maxHeadingDeltaDeg ?? 60;
  const threshold = onRoadThresholdM(fix.accuracyM);
  let best: RoadMatch | null = null;
  roads.forEach((timed, index) => {
    if (index === options.except) return;
    const proj = projectorFor(timed)(fix.coordinate);
    if (proj.distanceFromLineM > threshold) return;
    const g = timed.route.geometry;
    const i = Math.min(proj.index, g.length - 2);
    if (bearingDelta(bearingDeg(g[i], g[i + 1]), headingDeg) > maxDelta) return;
    if (!best || proj.distanceFromLineM < best.distanceFromRoadM) {
      best = { index, distanceAlongM: proj.distanceAlongM, distanceFromRoadM: proj.distanceFromLineM };
    }
  });
  return best;
}

/** Roads the car is on or right next to (within REACHABLE_ROAD_M), with where along each. */
export function roadsNearCar(roads: TimedRoute[], coordinate: LngLat, maxDistanceM = REACHABLE_ROAD_M): RoadMatch[] {
  const out: RoadMatch[] = [];
  roads.forEach((timed, index) => {
    const proj = projectorFor(timed)(coordinate);
    if (proj.distanceFromLineM <= maxDistanceM) out.push({ index, distanceAlongM: proj.distanceAlongM, distanceFromRoadM: proj.distanceFromLineM });
  });
  return out;
}

const coincideCache = new WeakMap<TimedRoute, WeakMap<TimedRoute, { bucket: number; params: string; value: boolean }>>();

/**
 * Does `road`, from `alongM` to its end, follow the `current` road (within
 * `bufferM`) all the way? Then it is not another road, only the same one
 * seen from a place where the two meet — e.g. after they rejoin.
 *
 * Costs tens of milliseconds, and the answer only changes as the car moves
 * on, so it is remembered per pair of roads for each 500 m of progress.
 */
export function coincidesAhead(road: TimedRoute, alongM: number, current: TimedRoute, bufferM = 120, share = 0.9): boolean {
  const remaining = road.totalDistM - alongM;
  if (remaining <= 0) return true;
  const bucket = Math.floor(alongM / 500);
  const params = `${bufferM}:${share}`;
  let byRoad = coincideCache.get(current);
  if (!byRoad) coincideCache.set(current, (byRoad = new WeakMap()));
  const hit = byRoad.get(road);
  if (hit && hit.bucket === bucket && hit.params === params) return hit.value;

  const project = projectorFor(current);
  // A road that differs from the current one by under 10 % is not "another road" anyway, so ~8 km spacing is plenty.
  const steps = Math.max(12, Math.min(40, Math.round(remaining / 2000)));
  let near = 0;
  for (let i = 1; i <= steps; i++) {
    const { coordinate } = pointAtDistance(road.route.geometry, road.cumDistM, alongM + (remaining * i) / steps);
    if (project(coordinate).distanceFromLineM <= bufferM) near++;
  }
  const value = near / steps >= share;
  byRoad.set(road, { bucket, params, value });
  return value;
}
