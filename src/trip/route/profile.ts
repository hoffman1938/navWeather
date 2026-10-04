import type { LngLat } from '../../types/geo';
import { decodePolyline, encodePolyline } from '../../utils/polyline';
import type { TripPlanRequest } from '../types';

/**
 * A route as the trip planner sees it: points resampled every `stepM` metres
 * along the road (so point i is at i × stepM, the last at the end), with the
 * cumulative DRIVING time at each point. Along-route positions therefore mean
 * the same thing on the client (its full route) and on the server.
 */
export interface RouteProfile {
  points: LngLat[];
  alongM: number[];
  timeS: number[];
  totalDistM: number;
  totalTimeS: number;
}

/** Build a profile from the request (server) — null when the arrays don't line up. */
export function profileFromRequest(route: TripPlanRequest['route']): RouteProfile | null {
  const points = decodePolyline(route.polyline, 5);
  if (points.length < 2 || points.length !== route.timesS.length) return null;
  const alongM = points.map((_, i) => Math.min(i * route.stepM, route.distanceM));
  alongM[alongM.length - 1] = route.distanceM;
  const timeS = route.timesS.slice();
  for (let i = 1; i < timeS.length; i++) if (!(timeS[i] >= timeS[i - 1])) return null; // monotonic
  return { points, alongM, timeS, totalDistM: route.distanceM, totalTimeS: timeS[timeS.length - 1] };
}

/**
 * Resample a route for a request (client): a point every `stepM` metres (and
 * at the end), with the driving time there. `stepM` grows on long routes so a
 * request stays small (≤ maxPoints points).
 */
export function resampleRoute(
  totalDistM: number,
  pointAt: (alongM: number) => LngLat,
  timeAt: (alongM: number) => number,
  maxPoints = 1500,
): { polyline: string; timesS: number[]; stepM: number } {
  const stepM = Math.max(500, Math.ceil(totalDistM / (maxPoints - 1) / 100) * 100);
  const points: LngLat[] = [];
  const timesS: number[] = [];
  for (let d = 0; d < totalDistM; d += stepM) {
    points.push(pointAt(d));
    timesS.push(Math.round(timeAt(d)));
  }
  points.push(pointAt(totalDistM));
  timesS.push(Math.round(timeAt(totalDistM)));
  for (let i = 1; i < timesS.length; i++) timesS[i] = Math.max(timesS[i], timesS[i - 1]);
  return { polyline: encodePolyline(points, 5), timesS, stepM };
}

function bracket(arr: number[], v: number): number {
  if (v <= arr[0]) return 0;
  if (v >= arr[arr.length - 1]) return arr.length - 2;
  let lo = 0;
  let hi = arr.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= v) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Driving time (s) to an along-route position. */
export function timeAtAlong(p: RouteProfile, alongM: number): number {
  if (alongM <= 0) return 0;
  if (alongM >= p.totalDistM) return p.totalTimeS;
  const i = bracket(p.alongM, alongM);
  const span = p.alongM[i + 1] - p.alongM[i];
  const t = span > 0 ? (alongM - p.alongM[i]) / span : 0;
  return p.timeS[i] + (p.timeS[i + 1] - p.timeS[i]) * t;
}

/** Along-route position reached after `timeS` seconds of driving. */
export function alongAtTime(p: RouteProfile, timeS: number): number {
  if (timeS <= 0) return 0;
  if (timeS >= p.totalTimeS) return p.totalDistM;
  const i = bracket(p.timeS, timeS);
  const span = p.timeS[i + 1] - p.timeS[i];
  const t = span > 0 ? (timeS - p.timeS[i]) / span : 0;
  return p.alongM[i] + (p.alongM[i + 1] - p.alongM[i]) * t;
}

/** Point on the route at an along-route position. */
export function pointAtAlong(p: RouteProfile, alongM: number): LngLat {
  const d = Math.max(0, Math.min(p.totalDistM, alongM));
  const i = bracket(p.alongM, d);
  const span = p.alongM[i + 1] - p.alongM[i];
  const t = span > 0 ? (d - p.alongM[i]) / span : 0;
  const a = p.points[i];
  const b = p.points[i + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Indices of the profile points within `radiusM` (along the road) of a position. */
export function windowAround(p: RouteProfile, alongM: number, radiusM: number): [number, number] {
  return [bracket(p.alongM, Math.max(0, alongM - radiusM)), Math.min(p.points.length - 1, bracket(p.alongM, alongM + radiusM) + 1)];
}
