import type { LngLat } from '../types/geo';
import type { TimedRoute } from '../types/route';
import type { RouteWeatherPoint, WeatherAtTime } from '../types/weather';
import { bearingDeg, pointAtDistance } from '../utils/distance';
import { createRouteProjector } from './placesAlongRoute';
import { timeAtDistance } from './routeTiming';

/**
 * ROAD HAZARDS — things a driver should hear about before reaching them:
 *  - sharp curves, found in the route geometry: a curve is flagged when the
 *    speed the route expects there (typical, from routing) is well above what
 *    its radius allows comfortably. Bends at maneuvers are left to the turn
 *    prompt; curves on slow roads are expected, not hazards.
 *  - railway level crossings, from OpenStreetMap (`railway=level_crossing`).
 * Derived from map data: the voice says "curve ahead", never a speed to drive.
 */

export type HazardKind = 'curve' | 'level_crossing';

export interface RoadHazard {
  id: string;
  kind: HazardKind;
  /** Where the hazard starts, along the route (m). */
  distanceAlongM: number;
  coordinate: LngLat;
  /** Curves: direction of the (first) bend and how far the road turns. */
  side?: 'left' | 'right';
  turnDeg?: number;
  /** Curves: several sharp bends in a row (announced once). */
  count?: number;
}

const STEP = 20; // m between heading samples
const WINDOWS = [3, 7]; // samples → 40 m (tight corners) and 120 m (long bends)
const MIN_TURN = 45; // °
const MIN_SPEED = 55 / 3.6; // m/s
const LATERAL = 3; // m/s² — comfortable cornering on a dry road
const MARGIN = 1.2;
const SERIES_GAP = 500; // m between bends that count as one "series of curves"

function signedDelta(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** Typical speed over [from, to] from the route timing (m/s). */
function speedOver(timed: TimedRoute, from: number, to: number): number {
  const a = Math.max(0, from);
  const b = Math.min(timed.totalDistM, to);
  const dt = timeAtDistance(timed, b) - timeAtDistance(timed, a);
  return dt > 0 && b > a ? (b - a) / dt : 0;
}

/** Stretches where the route itself turns (the maneuver prompt covers them). */
function maneuverZones(timed: TimedRoute): [number, number][] {
  const zones: [number, number][] = [];
  let project: ReturnType<typeof createRouteProjector> | null = null;
  for (const leg of timed.route.legs) {
    for (const st of leg.steps) {
      if (st.maneuverType === 'depart' || st.maneuverType === 'arrive') continue;
      let d: number;
      if (st.fromIndex !== undefined) d = timed.cumDistM[Math.min(st.fromIndex, timed.cumDistM.length - 1)];
      else {
        project ??= createRouteProjector(timed);
        d = project(st.location).distanceAlongM;
      }
      // Roundabouts and ramps curve by design for a while after the maneuver.
      const long = /roundabout|rotary|ramp|fork|merge/.test(st.maneuverType);
      zones.push([d - 80, d + (long ? 300 : 80)]);
    }
  }
  return zones;
}

export function findSharpCurves(timed: TimedRoute): RoadHazard[] {
  const g = timed.route.geometry;
  const total = timed.totalDistM;
  if (g.length < 3 || total < 400) return [];
  const n = Math.floor(total / STEP);
  const pts: LngLat[] = [];
  for (let i = 0; i <= n; i++) pts.push(pointAtDistance(g, timed.cumDistM, i * STEP).coordinate);
  const head: number[] = [];
  for (let i = 0; i < n; i++) head.push(bearingDeg(pts[i], pts[i + 1]));
  // turn[i]: heading change at pts[i + 1], i.e. at distance (i + 1) × STEP.
  const turn: number[] = [];
  for (let i = 0; i < n - 1; i++) turn.push(signedDelta(head[i], head[i + 1]));

  const zones = maneuverZones(timed);
  const inZone = (d: number) => d < 150 || d > total - 150 || zones.some(([a, b]) => d >= a && d <= b);

  type Hit = { i: number; turn: number; start: number };
  const hits: Hit[] = [];
  const sums = WINDOWS.map(() => 0);
  for (let i = 0; i < turn.length; i++) {
    let best: Hit | null = null;
    WINDOWS.forEach((k, w) => {
      sums[w] += turn[i] - (i >= k ? turn[i - k] : 0);
      if (i < k - 1) return;
      const t = sums[w];
      if (Math.abs(t) < MIN_TURN) return;
      const start = (i - k + 2) * STEP; // first turning point in the window
      const end = (i + 1) * STEP;
      if (inZone(start) || inZone(end)) return;
      const radius = Math.max(STEP, end - start) / ((Math.abs(t) * Math.PI) / 180);
      const v = speedOver(timed, start - 400, start - 50);
      if (v < MIN_SPEED || v <= MARGIN * Math.sqrt(LATERAL * radius)) return;
      if (!best || Math.abs(t) > Math.abs(best.turn)) best = { i, turn: t, start };
    });
    if (best) hits.push(best);
  }

  // Consecutive hits turning the same way are one bend.
  type Bend = { start: number; end: number; apex: number; turn: number };
  const bends: Bend[] = [];
  for (const h of hits) {
    const d = (h.i + 1) * STEP;
    const last = bends[bends.length - 1];
    if (last && Math.sign(last.turn) === Math.sign(h.turn) && h.start <= last.end + STEP) {
      last.end = d;
      if (Math.abs(h.turn) > Math.abs(last.turn)) {
        last.turn = h.turn;
        last.apex = d - STEP;
      }
    } else bends.push({ start: h.start, end: d, apex: d - STEP, turn: h.turn });
  }

  // Bends close together are one "series of curves".
  const out: RoadHazard[] = [];
  let series: { first: Bend; last: Bend; count: number } | null = null;
  const flush = () => {
    if (!series) return;
    const { first, count } = series;
    out.push({
      id: `curve@${Math.round(first.start)}`,
      kind: 'curve',
      distanceAlongM: first.start,
      coordinate: pointAtDistance(g, timed.cumDistM, first.apex).coordinate,
      side: first.turn > 0 ? 'right' : 'left',
      turnDeg: Math.round(Math.abs(first.turn)),
      ...(count > 1 ? { count } : {}),
    });
  };
  for (const b of bends) {
    if (series && b.start - series.last.end <= SERIES_GAP) {
      series.last = b;
      series.count++;
    } else {
      flush();
      series = { first: b, last: b, count: 1 };
    }
  }
  flush();
  return out;
}

/** Level crossings on the route itself (≤25 m from the line); multi-track nodes merged. */
export function snapLevelCrossings(points: { id: string; coordinate: LngLat }[], timed: TimedRoute): RoadHazard[] {
  if (!points.length) return [];
  const project = createRouteProjector(timed);
  const on = points
    .map((p) => ({ p, at: project(p.coordinate) }))
    .filter(({ at }) => at.distanceFromLineM <= 25)
    .sort((a, b) => a.at.distanceAlongM - b.at.distanceAlongM);
  const out: RoadHazard[] = [];
  for (const { p, at } of on) {
    const last = out[out.length - 1];
    if (last && at.distanceAlongM - last.distanceAlongM < 60) continue;
    out.push({ id: `rail:${p.id}`, kind: 'level_crossing', distanceAlongM: at.distanceAlongM, coordinate: p.coordinate });
  }
  return out;
}

export function mergeHazards(...lists: RoadHazard[][]): RoadHazard[] {
  return lists.flat().sort((a, b) => a.distanceAlongM - b.distanceAlongM);
}

/** The hazard to announce now: the next one within ~300 m or ~15 s, not yet announced. */
export function dueHazard(hazards: RoadHazard[], progressM: number, speedMps: number, announced: Set<string>): RoadHazard | null {
  const window = Math.max(300, speedMps * 15);
  for (const h of hazards) {
    const ahead = h.distanceAlongM - progressM;
    if (ahead < 0) continue;
    if (ahead > window) return null;
    if (!announced.has(h.id)) return h;
  }
  return null;
}

/** Road surface expected from the forecast at the time you get there. */
export type RoadSurface = 'dry' | 'wet' | 'icy';

export function roadSurface(w: WeatherAtTime | null | undefined): RoadSurface {
  if (!w) return 'dry';
  const wet = (w.precipitation ?? 0) >= 0.2 || (w.snowfall ?? 0) > 0;
  if ((w.snowfall ?? 0) > 0 || (wet && w.temperature <= 1)) return 'icy';
  return wet ? 'wet' : 'dry';
}

/** How a curve is described: one bend, a hairpin (≥150°), or a series. */
export type CurveKind = 'curve' | 'hairpin' | 'series';

export function hazardLabelKind(h: RoadHazard): CurveKind {
  if ((h.count ?? 1) > 1) return 'series';
  return (h.turnDeg ?? 0) >= 150 ? 'hairpin' : 'curve';
}

/** Forecast at the route weather point nearest to `distanceM` (within 15 km). */
export function weatherAtDistance(points: RouteWeatherPoint[], distanceM: number): WeatherAtTime | null {
  let best: RouteWeatherPoint | null = null;
  for (const p of points) {
    if (!p.weather) continue;
    if (!best || Math.abs(p.distanceFromStartKm * 1000 - distanceM) < Math.abs(best.distanceFromStartKm * 1000 - distanceM)) best = p;
  }
  return best && Math.abs(best.distanceFromStartKm * 1000 - distanceM) <= 15_000 ? best.weather : null;
}

/** The hazard to show on the sign: the next one within `aheadM`, until just past it. */
export function nextHazard(hazards: RoadHazard[], progressM: number, aheadM: number): RoadHazard | null {
  for (const h of hazards) {
    const ahead = h.distanceAlongM - progressM;
    if (ahead < -50) continue;
    return ahead <= aheadM ? h : null;
  }
  return null;
}
