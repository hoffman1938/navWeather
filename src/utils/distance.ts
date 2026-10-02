import type { BBox, LngLat } from '../types/geo';

export const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

/** Great-circle distance in metres. */
export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * DEG;
  const dLon = (b[0] - a[0]) * DEG;
  const lat1 = a[1] * DEG;
  const lat2 = b[1] * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cumulative distance per vertex; result[0] = 0, result[n-1] = total length. */
export function cumulativeDistances(coords: LngLat[]): Float64Array {
  const out = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) {
    out[i] = out[i - 1] + haversineM(coords[i - 1], coords[i]);
  }
  return out;
}

/** Initial bearing from a to b in degrees [0, 360). */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const lat1 = a[1] * DEG;
  const lat2 = b[1] * DEG;
  const dLon = (b[0] - a[0]) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/** The point `distanceM` away from `from` along an initial bearing (great circle). */
export function destinationPoint(from: LngLat, bearing: number, distanceM: number): LngLat {
  const d = distanceM / EARTH_RADIUS_M;
  const b = bearing * DEG;
  const lat1 = from[1] * DEG;
  const lon1 = from[0] * DEG;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [((lon2 / DEG + 540) % 360) - 180, lat2 / DEG];
}

/** Smallest absolute difference between two bearings (0–180). */
export function bearingDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Largest index i such that arr[i] <= value (arr ascending). Returns 0 for
 * values below the first element and arr.length - 1 above the last.
 */
export function lowerIndex(arr: ArrayLike<number>, value: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  if (hi <= 0 || value <= arr[0]) return 0;
  if (value >= arr[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= value) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpLngLat(a: LngLat, b: LngLat, t: number): LngLat {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
}

/** Coordinate at a given distance along a polyline. */
export function pointAtDistance(
  coords: LngLat[],
  cumDist: ArrayLike<number>,
  distanceM: number,
): { coordinate: LngLat; index: number } {
  const n = coords.length;
  if (n === 0) throw new Error('Empty polyline');
  if (n === 1 || distanceM <= 0) return { coordinate: coords[0], index: 0 };
  const total = cumDist[n - 1];
  if (distanceM >= total) return { coordinate: coords[n - 1], index: n - 2 };
  const i = lowerIndex(cumDist, distanceM);
  const segLen = cumDist[i + 1] - cumDist[i];
  const t = segLen > 0 ? (distanceM - cumDist[i]) / segLen : 0;
  return { coordinate: lerpLngLat(coords[i], coords[i + 1], t), index: i };
}

/**
 * Project p onto segment a-b using a local equirectangular approximation
 * (accurate to well under a metre for road-length segments).
 */
export function projectOntoSegment(
  p: LngLat,
  a: LngLat,
  b: LngLat,
): { t: number; distanceM: number; point: LngLat } {
  const cosLat = Math.cos(((a[1] + b[1]) / 2) * DEG);
  const ax = a[0] * cosLat;
  const bx = b[0] * cosLat;
  const px = p[0] * cosLat;
  const dx = bx - ax;
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const point = lerpLngLat(a, b, t);
  return { t, distanceM: haversineM(p, point), point };
}

export interface LineProjection {
  /** Index of the segment start vertex. */
  index: number;
  t: number;
  point: LngLat;
  distanceFromLineM: number;
  distanceAlongM: number;
}

/**
 * Nearest point on a polyline, optionally searching only a vertex window
 * (used during navigation so the vehicle cannot "jump" to another part of a
 * route that passes close by).
 */
export function projectOntoLine(
  coords: LngLat[],
  cumDist: ArrayLike<number>,
  p: LngLat,
  fromIndex = 0,
  toIndex = coords.length - 1,
): LineProjection {
  const start = Math.max(0, Math.min(fromIndex, coords.length - 2));
  const end = Math.max(start + 1, Math.min(toIndex, coords.length - 1));
  let best: LineProjection = {
    index: start,
    t: 0,
    point: coords[start],
    distanceFromLineM: Infinity,
    distanceAlongM: cumDist[start],
  };
  // Cheap pre-filter: skip segments whose bounding box is clearly far away.
  const cosLat = Math.cos(p[1] * DEG);
  for (let i = start; i < end; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    if (best.distanceFromLineM < Infinity) {
      const dLatMin = Math.min(Math.abs(p[1] - a[1]), Math.abs(p[1] - b[1]));
      const betweenLat = (p[1] - a[1]) * (p[1] - b[1]) <= 0;
      const dLonMin = Math.min(Math.abs(p[0] - a[0]), Math.abs(p[0] - b[0])) * cosLat;
      const betweenLon = (p[0] - a[0]) * (p[0] - b[0]) <= 0;
      const approx =
        Math.hypot(betweenLon ? 0 : dLonMin, betweenLat ? 0 : dLatMin) * DEG * EARTH_RADIUS_M;
      if (approx > best.distanceFromLineM) continue;
    }
    const proj = projectOntoSegment(p, a, b);
    if (proj.distanceM < best.distanceFromLineM) {
      const segLen = cumDist[i + 1] - cumDist[i];
      best = {
        index: i,
        t: proj.t,
        point: proj.point,
        distanceFromLineM: proj.distanceM,
        distanceAlongM: cumDist[i] + segLen * proj.t,
      };
    }
  }
  return best;
}

export function bboxOf(coords: LngLat[]): BBox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of coords) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

/** Slice of a polyline between two along-route distances (inclusive, interpolated ends). */
export function sliceLine(
  coords: LngLat[],
  cumDist: ArrayLike<number>,
  startM: number,
  endM: number,
): LngLat[] {
  if (coords.length < 2 || endM <= startM) return [];
  const a = pointAtDistance(coords, cumDist, startM);
  const b = pointAtDistance(coords, cumDist, endM);
  const out: LngLat[] = [a.coordinate];
  for (let i = a.index + 1; i <= b.index; i++) out.push(coords[i]);
  out.push(b.coordinate);
  return out;
}
