import type { SpeedLimitWay } from '../services/speed/SpeedLimitProvider';
import type { TimedRoute } from '../types/route';
import { bearingDeg, bearingDelta, lowerIndex, projectOntoSegment } from '../utils/distance';

export interface SpeedLimitRange {
  startM: number;
  endM: number;
  kmh: number;
}

export interface SpeedLimitProfile {
  ranges: SpeedLimitRange[];
  /** Fraction of the route with a known limit. */
  coverage: number;
  source: string;
}

const CELL = 0.005; // ≈ 500 m grid for the way-segment index

/**
 * Match OSM ways with speed limits onto the route: each route edge takes the
 * limit of a way segment within 15 m running in the same direction. Gaps stay
 * unknown — we never guess a limit.
 */
export function matchSpeedLimits(timed: TimedRoute, ways: SpeedLimitWay[], source = 'openstreetmap'): SpeedLimitProfile {
  const index = new Map<string, { a: [number, number]; b: [number, number]; kmh: number }[]>();
  const key = (lon: number, lat: number) => `${Math.floor(lon / CELL)},${Math.floor(lat / CELL)}`;
  for (const w of ways) {
    for (let i = 0; i < w.geometry.length - 1; i++) {
      const a = w.geometry[i];
      const b = w.geometry[i + 1];
      const cells = new Set([key(a[0], a[1]), key(b[0], b[1]), key((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)]);
      for (const c of cells) {
        let list = index.get(c);
        if (!list) index.set(c, (list = []));
        list.push({ a, b, kmh: w.kmh });
      }
    }
  }
  const g = timed.route.geometry;
  const edgeKmh: (number | null)[] = [];
  for (let i = 0; i < g.length - 1; i++) {
    const mid: [number, number] = [(g[i][0] + g[i + 1][0]) / 2, (g[i][1] + g[i + 1][1]) / 2];
    const heading = bearingDeg(g[i], g[i + 1]);
    let best: { d: number; kmh: number } | null = null;
    const cx = Math.floor(mid[0] / CELL);
    const cy = Math.floor(mid[1] / CELL);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const s of index.get(`${cx + dx},${cy + dy}`) ?? []) {
          const p = projectOntoSegment(mid, s.a, s.b);
          if (p.distanceM > 15) continue;
          const hb = bearingDeg(s.a, s.b);
          if (Math.min(bearingDelta(hb, heading), bearingDelta((hb + 180) % 360, heading)) > 30) continue;
          if (!best || p.distanceM < best.d) best = { d: p.distanceM, kmh: s.kmh };
        }
      }
    }
    edgeKmh.push(best?.kmh ?? null);
  }
  const ranges: SpeedLimitRange[] = [];
  let known = 0;
  for (let i = 0; i < edgeKmh.length; i++) {
    const kmh = edgeKmh[i];
    if (kmh === null) continue;
    const startM = timed.cumDistM[i];
    const endM = timed.cumDistM[i + 1];
    known += endM - startM;
    const last = ranges[ranges.length - 1];
    if (last && last.kmh === kmh && startM - last.endM < 60) last.endM = endM;
    else ranges.push({ startM, endM, kmh });
  }
  // Drop tiny blips (<120 m) that are usually junction artefacts.
  const clean = ranges.filter((r) => r.endM - r.startM >= 120);
  return { ranges: clean, coverage: timed.totalDistM > 0 ? known / timed.totalDistM : 0, source };
}

export function speedLimitAt(profile: SpeedLimitProfile | null, distanceM: number): number | null {
  if (!profile || profile.ranges.length === 0) return null;
  const starts = profile.ranges.map((r) => r.startM);
  const i = lowerIndex(starts, distanceM);
  const r = profile.ranges[i];
  return r && distanceM >= r.startM && distanceM <= r.endM ? r.kmh : null;
}

/** Next change of limit within `withinM` ahead (for "80 in 1.2 km"). */
export function nextSpeedLimitChange(
  profile: SpeedLimitProfile | null,
  distanceM: number,
  withinM = 2000,
): { kmh: number; distanceM: number } | null {
  if (!profile) return null;
  const current = speedLimitAt(profile, distanceM);
  for (const r of profile.ranges) {
    if (r.startM <= distanceM) continue;
    if (r.startM - distanceM > withinM) break;
    if (r.kmh !== current) return { kmh: r.kmh, distanceM: r.startM - distanceM };
  }
  return null;
}

/**
 * Speeding with hysteresis: on when above limit + tolerance for 5 s,
 * off when back under limit + 2 km/h for 3 s. No constant nagging.
 */
export function updateSpeeding(
  state: { speeding: boolean; since: number | null },
  speedKmh: number | null,
  limitKmh: number | null,
  nowMs: number,
): { speeding: boolean; since: number | null } {
  if (speedKmh === null || limitKmh === null) return { speeding: false, since: null };
  const tolerance = Math.max(5, limitKmh * 0.05);
  const over = speedKmh > limitKmh + tolerance;
  const under = speedKmh <= limitKmh + 2;
  if (!state.speeding) {
    if (!over) return { speeding: false, since: null };
    const since = state.since ?? nowMs;
    return { speeding: nowMs - since >= 5000, since };
  }
  if (!under) return { speeding: true, since: null };
  const since = state.since ?? nowMs;
  return { speeding: nowMs - since < 3000, since: nowMs - since < 3000 ? since : null };
}
