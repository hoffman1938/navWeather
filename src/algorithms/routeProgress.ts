import type { LngLat } from '../types/geo';
import type { RouteProgress } from '../types/navigation';
import type { TimedRoute } from '../types/route';
import { createRouteProjector } from './placesAlongRoute';
import { timeAtDistance } from './routeTiming';

/**
 * Tracks the vehicle along the route. Searches a window ahead of the last
 * known position first (so a route that doubles back near itself can't make
 * the vehicle jump), falling back to a full search when far off.
 */
export function createProgressTracker(timed: TimedRoute) {
  const project = createRouteProjector(timed);
  const n = timed.route.geometry.length;
  let lastIndex = -1;

  return function track(coordinate: LngLat, nowMs: number): RouteProgress {
    let proj = null as ReturnType<typeof project> | null;
    if (lastIndex >= 0) {
      const windowed = project(coordinate, { from: Math.max(0, lastIndex - 30), to: Math.min(n - 1, lastIndex + 600) });
      if (windowed.distanceFromLineM < 250) proj = windowed;
    }
    if (!proj) proj = project(coordinate);
    lastIndex = proj.index;
    const modelTimeS = timeAtDistance(timed, proj.distanceAlongM);
    const remainingTimeS = Math.max(0, timed.totalTimeS - modelTimeS);
    return {
      distanceAlongM: proj.distanceAlongM,
      modelTimeS,
      distanceFromRouteM: proj.distanceFromLineM,
      segmentIndex: proj.index,
      remainingDistanceM: Math.max(0, timed.totalDistM - proj.distanceAlongM),
      remainingTimeS,
      nowMs,
      etaMs: nowMs + remainingTimeS * 1000,
    };
  };
}

/** Expected road speed at a geometry edge (m/s), for deviation thresholds. */
export function edgeSpeedMps(timed: TimedRoute, index: number): number | undefined {
  const i = Math.max(0, Math.min(index, timed.cumDistM.length - 2));
  const dt = timed.cumTimeS[i + 1] - timed.cumTimeS[i];
  const dd = timed.cumDistM[i + 1] - timed.cumDistM[i];
  return dt > 0 ? dd / dt : undefined;
}
