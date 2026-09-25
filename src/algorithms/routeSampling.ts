import type { ElevationProfile, PlaceAlongRoute, RouteSample, SampleReason, TimedRoute } from '../types/route';
import type { WeatherAtTime } from '../types/weather';
import { bearingDeg, bearingDelta, lowerIndex } from '../utils/distance';
import { placeImportance } from './placesAlongRoute';
import { distanceAtTime, positionAtDistance, timeAtDistance } from './routeTiming';
import { isPrecipitating } from './weatherMatching';

/**
 * ADAPTIVE ROUTE SAMPLING.
 *
 * Picks the route positions to request weather for. Never every vertex:
 * a distance-based budget sets the density, then points are placed where
 * weather is most likely to matter or change:
 *   - origin and destination
 *   - settlements (cities > towns > villages)
 *   - mountain passes / valleys (elevation extrema)
 *   - major route changes (junctions onto long new roads)
 *   - at least every `maxIntervalMinutes` of driving
 *   - evenly spaced fill to reach the density budget
 * A second pass (refineSamplesForWeather) adds points where neighbouring
 * forecasts differ significantly.
 */

export interface SamplingBudget {
  min: number;
  max: number;
  target: number;
}

/** Distance bands from the product spec; >1000 km scales adaptively. */
export function samplingBudget(totalKm: number): SamplingBudget {
  const bands: [number, number, number, number][] = [
    // [fromKm, toKm, minPoints, maxPoints]
    [0, 50, 5, 10],
    [50, 200, 10, 20],
    [200, 500, 15, 30],
    [500, 1000, 25, 50],
  ];
  for (const [lo, hi, min, max] of bands) {
    if (totalKm < hi) {
      const frac = Math.max(0, Math.min(1, (totalKm - lo) / (hi - lo)));
      return { min, max, target: Math.round(min + (max - min) * frac) };
    }
  }
  // 1000+ km: ~1 point per 20 km beyond 1000, capped to keep requests modest.
  const target = Math.min(150, Math.round(50 + (totalKm - 1000) / 20));
  return { min: 50, max: Math.min(160, target + 10), target };
}

const PRIORITY: Record<SampleReason, number> = {
  origin: 1000,
  destination: 1000,
  'weather-change': 400,
  settlement: 200,
  elevation: 250,
  time: 150,
  junction: 120,
  turn: 110,
  distance: 10,
};

interface Candidate {
  distanceM: number;
  reason: SampleReason;
  priority: number;
  place?: PlaceAlongRoute;
  elevationM?: number;
}

export interface SamplingInput {
  timed: TimedRoute;
  places?: PlaceAlongRoute[];
  elevation?: ElevationProfile | null;
  maxIntervalMinutes?: number;
}

export function sampleRoute(input: SamplingInput): RouteSample[] {
  const { timed, places = [], elevation } = input;
  const total = timed.totalDistM;
  const maxIntervalS = (input.maxIntervalMinutes ?? 45) * 60;
  if (total <= 0 || timed.route.geometry.length < 2) return [];

  const budget = samplingBudget(total / 1000);
  const minSpacing = Math.max(300, total / (budget.max * 1.5));

  // 1. Candidates.
  const candidates: Candidate[] = [];
  for (const p of places) {
    if (p.distanceAlongM < 0 || p.distanceAlongM > total) continue;
    candidates.push({
      distanceM: p.distanceAlongM,
      reason: 'settlement',
      priority: PRIORITY.settlement + placeImportance(p) / 1e7 * 20 + Math.log10((p.population ?? 1) + 1),
      place: p,
    });
  }
  if (elevation) {
    for (const f of elevationExtrema(elevation, 200)) {
      candidates.push({ distanceM: f.distanceM, reason: 'elevation', priority: PRIORITY.elevation, elevationM: f.elevationM });
    }
  }
  for (const d of junctionDistances(timed, Math.max(8000, total * 0.04))) {
    candidates.push({ distanceM: d, reason: 'junction', priority: PRIORITY.junction });
  }
  for (const d of headingChangeDistances(timed, Math.max(8000, total / 25))) {
    candidates.push({ distanceM: d, reason: 'turn', priority: PRIORITY.turn });
  }
  for (let t = maxIntervalS; t < timed.totalTimeS - maxIntervalS / 3; t += maxIntervalS) {
    candidates.push({ distanceM: distanceAtTime(timed, t), reason: 'time', priority: PRIORITY.time });
  }

  // 2. Greedy acceptance by priority with minimum spacing; merge reasons.
  const accepted: (Candidate & { reasons: Set<SampleReason> })[] = [
    { distanceM: 0, reason: 'origin', priority: PRIORITY.origin, reasons: new Set(['origin']) },
    { distanceM: total, reason: 'destination', priority: PRIORITY.destination, reasons: new Set(['destination']) },
  ];
  candidates.sort((a, b) => b.priority - a.priority);
  for (const c of candidates) {
    let nearest: (typeof accepted)[number] | undefined;
    let nearestGap = Infinity;
    for (const a of accepted) {
      const gap = Math.abs(a.distanceM - c.distanceM);
      if (gap < nearestGap) {
        nearestGap = gap;
        nearest = a;
      }
    }
    // Settlements need a bit less spacing so named places are not lost.
    const spacing = c.reason === 'settlement' ? minSpacing * 0.6 : minSpacing;
    if (nearestGap >= spacing) {
      accepted.push({ ...c, reasons: new Set([c.reason]) });
    } else if (nearest) {
      nearest.reasons.add(c.reason);
      if (c.place && !nearest.place && nearestGap < minSpacing * 0.5) nearest.place = c.place;
      if (c.elevationM !== undefined && nearest.elevationM === undefined) nearest.elevationM = c.elevationM;
    }
  }
  accepted.sort((a, b) => a.distanceM - b.distanceM);

  // 3. Fill: even distance spacing toward the target density, and the time cap.
  const spacing = total / Math.max(1, budget.target - 1);
  const filled: typeof accepted = [];
  for (let i = 0; i < accepted.length; i++) {
    const a = accepted[i];
    filled.push(a);
    const b = accepted[i + 1];
    if (!b) break;
    const gap = b.distanceM - a.distanceM;
    const gapS = timeAtDistance(timed, b.distanceM) - timeAtDistance(timed, a.distanceM);
    const byDistance = gap > spacing * 1.25 ? Math.round(gap / spacing) - 1 : 0;
    const byTime = gapS > maxIntervalS ? Math.ceil(gapS / maxIntervalS) - 1 : 0;
    const k = Math.max(byDistance, byTime);
    for (let j = 1; j <= k; j++) {
      const reason: SampleReason = byTime >= byDistance && byTime > 0 ? 'time' : 'distance';
      const ta = timeAtDistance(timed, a.distanceM);
      const d =
        reason === 'time'
          ? distanceAtTime(timed, ta + (gapS * j) / (k + 1))
          : a.distanceM + (gap * j) / (k + 1);
      filled.push({ distanceM: d, reason, priority: PRIORITY[reason], reasons: new Set([reason]) });
    }
  }

  // 4. Cap at the budget maximum without breaking the time constraint.
  const pts = filled;
  while (pts.length > budget.max) {
    let removeAt = -1;
    let bestScore = Infinity;
    for (let i = 1; i < pts.length - 1; i++) {
      const merged = pts[i + 1].distanceM - pts[i - 1].distanceM;
      const mergedS = timeAtDistance(timed, pts[i + 1].distanceM) - timeAtDistance(timed, pts[i - 1].distanceM);
      if (mergedS > maxIntervalS) continue;
      const score = pts[i].priority * 1e6 + merged;
      if (score < bestScore) {
        bestScore = score;
        removeAt = i;
      }
    }
    if (removeAt < 0) break;
    pts.splice(removeAt, 1);
  }

  return pts.map((p) => buildSample(timed, p.distanceM, [...p.reasons], p.place, elevation, p.elevationM));
}

function buildSample(
  timed: TimedRoute,
  distanceM: number,
  reasons: SampleReason[],
  place: PlaceAlongRoute | undefined,
  elevation: ElevationProfile | null | undefined,
  elevationM?: number,
): RouteSample {
  const { coordinate } = positionAtDistance(timed, distanceM);
  const route = timed.route;
  const sorted = [...reasons].sort((a, b) => PRIORITY[b] - PRIORITY[a]);
  let placeName: string | undefined;
  let placeRelation: 'in' | 'near' | undefined;
  if (sorted.includes('origin')) {
    placeName = route.origin.name;
    placeRelation = 'in';
  } else if (sorted.includes('destination')) {
    placeName = route.destination.name;
    placeRelation = 'in';
  } else if (place) {
    placeName = place.name;
    placeRelation = 'in';
  }
  return {
    id: `${route.id}:${Math.round(distanceM)}`,
    coordinate,
    distanceM,
    travelTimeS: timeAtDistance(timed, distanceM),
    reasons: sorted,
    placeName,
    placeRelation,
    placeKind: place?.kind,
    elevationM: elevationM ?? (elevation ? elevationAt(elevation, distanceM) : undefined),
  };
}

/**
 * Give unnamed samples the nearest settlement name ("near Surami") when one
 * lies within `radiusM` along the route. Mutates nothing; returns new samples.
 */
export function nameSamples(samples: RouteSample[], places: PlaceAlongRoute[], radiusM: number): RouteSample[] {
  if (places.length === 0) return samples;
  return samples.map((s) => {
    if (s.placeName) return s;
    let best: PlaceAlongRoute | undefined;
    let bestScore = -Infinity;
    for (const p of places) {
      const gap = Math.abs(p.distanceAlongM - s.distanceM);
      if (gap > radiusM) continue;
      // Prefer close places, then important ones.
      const score = -gap / radiusM + placeImportance(p) / 1e8;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (!best) return s;
    const inPlace = Math.abs(best.distanceAlongM - s.distanceM) < 1500 && best.offsetM < 1500;
    return { ...s, placeName: best.name, placeRelation: inPlace ? 'in' : 'near', placeKind: best.kind };
  });
}

/** Elevation extrema whose rise/fall to neighbours is ≥ `prominenceM` (zig-zag). */
export function elevationExtrema(
  profile: ElevationProfile,
  prominenceM: number,
): { distanceM: number; elevationM: number; kind: 'peak' | 'valley' }[] {
  const { distancesM: d, elevationsM: e } = profile;
  const out: { distanceM: number; elevationM: number; kind: 'peak' | 'valley' }[] = [];
  if (e.length < 3) return out;
  const push = (i: number, kind: 'peak' | 'valley') =>
    out.push({ distanceM: d[i], elevationM: e[i], kind });
  let trend: 0 | 1 | -1 = 0; // 1 = climbing (tracking a max), -1 = descending (tracking a min)
  let minIdx = 0;
  let maxIdx = 0;
  let ext = 0;
  for (let i = 1; i < e.length; i++) {
    if (trend === 0) {
      if (e[i] > e[maxIdx]) maxIdx = i;
      if (e[i] < e[minIdx]) minIdx = i;
      if (e[maxIdx] - e[minIdx] >= prominenceM) {
        if (maxIdx > minIdx) {
          push(minIdx, 'valley');
          trend = 1;
          ext = maxIdx;
        } else {
          push(maxIdx, 'peak');
          trend = -1;
          ext = minIdx;
        }
      }
    } else if (trend === 1) {
      if (e[i] > e[ext]) ext = i;
      else if (e[ext] - e[i] >= prominenceM) {
        push(ext, 'peak');
        trend = -1;
        ext = i;
      }
    } else {
      if (e[i] < e[ext]) ext = i;
      else if (e[i] - e[ext] >= prominenceM) {
        push(ext, 'valley');
        trend = 1;
        ext = i;
      }
    }
  }
  // Drop extrema at the route ends (the endpoints are sampled anyway).
  const total = d[d.length - 1];
  return out.filter((x) => x.distanceM > total * 0.02 && x.distanceM < total * 0.98);
}

export function elevationAt(profile: ElevationProfile, distanceM: number): number | undefined {
  const { distancesM: d, elevationsM: e } = profile;
  if (d.length === 0) return undefined;
  const i = lowerIndex(d, distanceM);
  if (i >= d.length - 1) return e[d.length - 1];
  const span = d[i + 1] - d[i];
  const t = span > 0 ? Math.max(0, Math.min(1, (distanceM - d[i]) / span)) : 0;
  return Math.round(e[i] + (e[i + 1] - e[i]) * t);
}

/**
 * Significant route geometry changes: where the overall heading, measured
 * over `windowM` chords, turns by ≥ `minTurnDeg` (e.g. heading west, then
 * south along a coast). Long windows ignore ordinary bends and serpentines.
 */
export function headingChangeDistances(timed: TimedRoute, windowM: number, minTurnDeg = 55): number[] {
  const total = timed.totalDistM;
  if (total < windowM * 3) return [];
  const marks: number[] = [];
  for (let d = 0; d < total; d += windowM) marks.push(d);
  marks.push(total);
  const pts = marks.map((d) => positionAtDistance(timed, d).coordinate);
  const bearings: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    if (marks[i + 1] - marks[i] < windowM / 2) break; // ignore a short final stub
    bearings.push(bearingDeg(pts[i], pts[i + 1]));
  }
  const out: number[] = [];
  const add = (at: number) => {
    if (!out.length || at - out[out.length - 1] > windowM) out.push(at);
  };
  for (let i = 1; i < bearings.length; i++) {
    if (bearingDelta(bearings[i - 1], bearings[i]) >= minTurnDeg) {
      add(marks[i]); // corner at the window boundary
    } else if (i >= 2 && bearingDelta(bearings[i - 2], bearings[i]) >= minTurnDeg) {
      add(marks[i - 1] + windowM / 2); // corner inside window i-1, split across two steps
    }
  }
  return out;
}

/** Distances where the route turns onto a long new road (significant route change). */
function junctionDistances(timed: TimedRoute, minNextStepM: number): number[] {
  const types = new Set(['turn', 'fork', 'merge', 'on ramp', 'off ramp', 'end of road', 'roundabout', 'rotary']);
  const out: number[] = [];
  for (const leg of timed.route.legs) {
    for (const s of leg.steps) {
      if (!types.has(s.maneuverType) || s.fromIndex === undefined) continue;
      if (s.distanceM < minNextStepM) continue;
      out.push(timed.cumDistM[s.fromIndex]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Weather-driven refinement

export type WeatherSeverityClass = 'dry' | 'fog' | 'rain' | 'heavy' | 'wintry' | 'storm';

export function severityClass(w: WeatherAtTime): WeatherSeverityClass {
  switch (w.condition) {
    case 'THUNDERSTORM':
      return 'storm';
    case 'SNOW':
    case 'SLEET':
      return 'wintry';
    case 'HEAVY_RAIN':
      return 'heavy';
    case 'RAIN':
      return 'rain';
    case 'FOG':
      return 'fog';
    default:
      return 'dry';
  }
}

/** Do two neighbouring forecasts differ enough to warrant a point in between? */
export function weatherDiffers(a: WeatherAtTime, b: WeatherAtTime): number {
  let score = 0;
  if (severityClass(a) !== severityClass(b)) score += 3;
  if (isPrecipitating(a.condition) !== isPrecipitating(b.condition)) score += 1;
  const dT = Math.abs(a.temperature - b.temperature);
  if (dT >= 4) score += dT / 4;
  const dP = Math.abs((a.precipitationProbability ?? 0) - (b.precipitationProbability ?? 0));
  if (dP >= 30) score += dP / 30;
  return score;
}

/**
 * New samples halfway between neighbours whose weather differs a lot
 * (precipitation boundaries, temperature jumps). Returns only the new ones.
 */
export function refineSamplesForWeather(
  samples: RouteSample[],
  weatherById: Map<string, WeatherAtTime | null>,
  timed: TimedRoute,
  options: { maxAdditional: number; minGapM: number; elevation?: ElevationProfile | null },
): RouteSample[] {
  const candidates: { distanceM: number; score: number }[] = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const wa = weatherById.get(a.id);
    const wb = weatherById.get(b.id);
    if (!wa || !wb) continue;
    if (b.distanceM - a.distanceM < options.minGapM * 2) continue;
    const score = weatherDiffers(wa, wb);
    if (score >= 3) candidates.push({ distanceM: (a.distanceM + b.distanceM) / 2, score });
  }
  return candidates
    .sort((x, y) => y.score - x.score)
    .slice(0, options.maxAdditional)
    .map((c) => buildSample(timed, c.distanceM, ['weather-change'], undefined, options.elevation));
}

/** Merge and sort samples by distance, dropping exact duplicates. */
export function mergeSamples(a: RouteSample[], b: RouteSample[]): RouteSample[] {
  const byId = new Map<string, RouteSample>();
  for (const s of [...a, ...b]) if (!byId.has(s.id)) byId.set(s.id, s);
  return [...byId.values()].sort((x, y) => x.distanceM - y.distanceM);
}
