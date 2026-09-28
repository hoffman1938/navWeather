import type { LngLat } from '../types/geo';

/** Perpendicular distance of p from segment a–b, in degrees (fine for simplification). */
function segDist(p: LngLat, a: LngLat, b: LngLat): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function douglasPeucker(pts: LngLat[], eps: number): LngLat[] {
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let max = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(pts[i], pts[s], pts[e]);
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (idx > 0 && max > eps) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Simplify a line to at most `maxPoints` vertices, keeping its shape (endpoints preserved). */
export function simplifyLine(pts: LngLat[], maxPoints: number): LngLat[] {
  if (pts.length <= maxPoints) return pts.map((p) => [p[0], p[1]]);
  let eps = 0.00005; // ≈ 5 m
  let out = douglasPeucker(pts, eps);
  while (out.length > maxPoints) {
    eps *= 1.6;
    out = douglasPeucker(pts, eps);
  }
  return out;
}
