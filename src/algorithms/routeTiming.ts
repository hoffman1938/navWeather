import type { LngLat } from '../types/geo';
import type { Route, RouteSample, TimedRoute } from '../types/route';
import { cumulativeDistances, haversineM, lowerIndex, pointAtDistance } from '../utils/distance';

/**
 * ROUTE → TIME MAPPING.
 *
 * Builds cumulative travel time for every geometry vertex from the route's
 * segments. Accuracy follows the segment source:
 *   1. OSRM per-edge annotations (one segment per edge)
 *   2. OSRM step durations (distributed over the step's edges by length)
 *   3. total duration distributed proportionally to distance (fallback)
 * Segment `currentDurationS` (live traffic) wins over `durationS` when set.
 */
export function buildTimedRoute(route: Route): TimedRoute {
  const coords = route.geometry;
  const n = coords.length;
  const cumDistM = cumulativeDistances(coords);
  const totalDistM = cumDistM[n - 1] ?? 0;
  const edgeTime = new Float64Array(Math.max(0, n - 1));
  const covered = new Uint8Array(Math.max(0, n - 1));

  for (const seg of route.segments) {
    const from = Math.max(0, Math.min(seg.fromIndex, n - 1));
    const to = Math.max(from, Math.min(seg.toIndex, n - 1));
    if (to === from) continue;
    const duration = seg.currentDurationS ?? seg.durationS;
    const segLen = cumDistM[to] - cumDistM[from];
    const edges = to - from;
    for (let i = from; i < to; i++) {
      const share = segLen > 0 ? (cumDistM[i + 1] - cumDistM[i]) / segLen : 1 / edges;
      edgeTime[i] += duration * share;
      covered[i] = 1;
    }
  }

  // Edges no segment covered (shouldn't happen, but never leave holes):
  // use the route's average speed.
  const avgSpeed = route.durationS > 0 && route.distanceM > 0 ? route.distanceM / route.durationS : 13.9;
  for (let i = 0; i < n - 1; i++) {
    if (!covered[i]) edgeTime[i] = haversineM(coords[i], coords[i + 1]) / avgSpeed;
  }

  const cumTimeS = new Float64Array(n);
  for (let i = 1; i < n; i++) cumTimeS[i] = cumTimeS[i - 1] + edgeTime[i - 1];

  return {
    route,
    cumDistM,
    cumTimeS,
    totalDistM,
    totalTimeS: cumTimeS[n - 1] ?? 0,
    timingSource: route.segmentSource,
  };
}

/** Travel time (s from start) to reach a distance along the route. */
export function timeAtDistance(timed: TimedRoute, distanceM: number): number {
  const { cumDistM, cumTimeS } = timed;
  const n = cumDistM.length;
  if (n < 2 || distanceM <= 0) return 0;
  if (distanceM >= cumDistM[n - 1]) return cumTimeS[n - 1];
  const i = lowerIndex(cumDistM, distanceM);
  const span = cumDistM[i + 1] - cumDistM[i];
  const t = span > 0 ? (distanceM - cumDistM[i]) / span : 0;
  return cumTimeS[i] + (cumTimeS[i + 1] - cumTimeS[i]) * t;
}

/** Distance along the route reached after `seconds` of driving. */
export function distanceAtTime(timed: TimedRoute, seconds: number): number {
  const { cumDistM, cumTimeS } = timed;
  const n = cumTimeS.length;
  if (n < 2 || seconds <= 0) return 0;
  if (seconds >= cumTimeS[n - 1]) return cumDistM[n - 1];
  const i = lowerIndex(cumTimeS, seconds);
  const span = cumTimeS[i + 1] - cumTimeS[i];
  const t = span > 0 ? (seconds - cumTimeS[i]) / span : 0;
  return cumDistM[i] + (cumDistM[i + 1] - cumDistM[i]) * t;
}

export function positionAtDistance(timed: TimedRoute, distanceM: number): { coordinate: LngLat; index: number } {
  return pointAtDistance(timed.route.geometry, timed.cumDistM, distanceM);
}

/**
 * "Where will the driver be at `atMs`?" given a departure time.
 * Returns null before departure; clamps to the destination after arrival.
 */
export function whereAtTime(
  timed: TimedRoute,
  departureMs: number,
  atMs: number,
): { coordinate: LngLat; distanceM: number; travelTimeS: number; arrived: boolean } | null {
  if (atMs < departureMs) return null;
  const travelTimeS = Math.min(timed.totalTimeS, (atMs - departureMs) / 1000);
  const distanceM = distanceAtTime(timed, travelTimeS);
  return {
    coordinate: positionAtDistance(timed, distanceM).coordinate,
    distanceM,
    travelTimeS,
    arrived: travelTimeS >= timed.totalTimeS,
  };
}

/**
 * Estimated arrival (UTC ms) for each sample.
 *  - planning: departure + cumulative travel time to the sample
 *  - navigating: now + remaining travel time from the vehicle to the sample;
 *    samples already behind the vehicle keep their planned time
 */
export function computeArrivals(
  samples: RouteSample[],
  clock:
    | { mode: 'planning'; departureMs: number }
    | { mode: 'navigating'; nowMs: number; modelTimeS: number; departureMs: number },
): number[] {
  return samples.map((s) => {
    if (clock.mode === 'planning') return clock.departureMs + s.travelTimeS * 1000;
    const ahead = s.travelTimeS - clock.modelTimeS;
    return ahead >= 0 ? clock.nowMs + ahead * 1000 : clock.departureMs + s.travelTimeS * 1000;
  });
}
