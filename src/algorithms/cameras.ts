import type { SpeedCamera } from '../services/speed/SpeedLimitProvider';
import type { TimedRoute } from '../types/route';
import { createRouteProjector } from './placesAlongRoute';

export interface RouteCamera extends SpeedCamera {
  distanceAlongM: number;
}

/** Cameras on the route itself (≤40 m from the line), in driving order. */
export function snapCamerasToRoute(cameras: SpeedCamera[], timed: TimedRoute): RouteCamera[] {
  if (!cameras.length) return [];
  const project = createRouteProjector(timed);
  const out: RouteCamera[] = [];
  for (const c of cameras) {
    const p = project(c.coordinate);
    if (p.distanceFromLineM <= 40) out.push({ ...c, distanceAlongM: p.distanceAlongM });
  }
  return out.sort((a, b) => a.distanceAlongM - b.distanceAlongM);
}

/** The camera to announce now: the next one within ~600 m or ~25 s, not yet announced. */
export function dueCamera(cameras: RouteCamera[], progressM: number, speedMps: number, announced: Set<string>): RouteCamera | null {
  const window = Math.max(600, speedMps * 25);
  for (const c of cameras) {
    const ahead = c.distanceAlongM - progressM;
    if (ahead < 0) continue;
    if (ahead > window) return null;
    if (!announced.has(c.id)) return c;
  }
  return null;
}
