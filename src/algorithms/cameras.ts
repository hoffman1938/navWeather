import type { SpeedCamera } from '../services/speed/SpeedLimitProvider';
import type { TimedRoute } from '../types/route';
import { createRouteProjector } from './placesAlongRoute';

export interface RouteCamera extends SpeedCamera {
  distanceAlongM: number;
}

/** Cameras closer than this along the road are one camera (OSM often maps one node per direction, B-14). */
const SAME_CAMERA_M = 150;

/** Cameras on the route itself (≤40 m from the line), in driving order, one per place (the stricter limit kept). */
export function snapCamerasToRoute(cameras: SpeedCamera[], timed: TimedRoute): RouteCamera[] {
  if (!cameras.length) return [];
  const project = createRouteProjector(timed);
  const on: RouteCamera[] = [];
  for (const c of cameras) {
    const p = project(c.coordinate);
    if (p.distanceFromLineM <= 40) on.push({ ...c, distanceAlongM: p.distanceAlongM });
  }
  on.sort((a, b) => a.distanceAlongM - b.distanceAlongM);
  const out: RouteCamera[] = [];
  for (const c of on) {
    const last = out.at(-1);
    if (last && c.distanceAlongM - last.distanceAlongM <= SAME_CAMERA_M) {
      const kmh = last.kmh === undefined ? c.kmh : c.kmh === undefined ? last.kmh : Math.min(last.kmh, c.kmh);
      out[out.length - 1] = { ...last, ...(kmh !== undefined ? { kmh } : {}) };
      continue;
    }
    out.push(c);
  }
  return out;
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
