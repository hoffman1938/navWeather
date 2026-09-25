import type { LngLat } from '../types/geo';
import type { PlaceAlongRoute, PlaceKind, TimedRoute } from '../types/route';
import type { RawPlace } from '../services/places/PlacesProvider';
import { projectOntoLine, type LineProjection } from '../utils/distance';

/** Max distance from the road for a settlement to count as "on the route". */
export const MAX_OFFSET_BY_KIND: Record<PlaceKind, number> = {
  city: 8000,
  town: 4000,
  village: 1500,
};

/**
 * Coarse-to-fine projection: project onto a decimated copy of the route
 * (≤ ~1500 vertices), then refine on the full geometry around the hit.
 * Keeps place snapping and GPS matching fast on 1000+ km routes.
 */
export function createRouteProjector(timed: TimedRoute) {
  const coords = timed.route.geometry;
  const n = coords.length;
  const stride = Math.max(1, Math.ceil(n / 1500));
  const idx: number[] = [];
  for (let i = 0; i < n; i += stride) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  const coarse: LngLat[] = idx.map((i) => coords[i]);
  const coarseCum = idx.map((i) => timed.cumDistM[i]);

  return function project(p: LngLat, window?: { from: number; to: number }): LineProjection {
    if (window) return projectOntoLine(coords, timed.cumDistM, p, window.from, window.to);
    if (stride === 1) return projectOntoLine(coords, timed.cumDistM, p);
    const c = projectOntoLine(coarse, coarseCum, p);
    const from = Math.max(0, idx[Math.max(0, c.index - 1)]);
    const to = Math.min(n - 1, idx[Math.min(idx.length - 1, c.index + 2)]);
    return projectOntoLine(coords, timed.cumDistM, p, from, to);
  };
}

export function snapPlacesToRoute(places: RawPlace[], timed: TimedRoute): PlaceAlongRoute[] {
  const project = createRouteProjector(timed);
  const out: PlaceAlongRoute[] = [];
  for (const p of places) {
    const proj = project(p.coordinate);
    if (proj.distanceFromLineM > MAX_OFFSET_BY_KIND[p.kind]) continue;
    out.push({
      id: p.id,
      name: p.name,
      kind: p.kind,
      population: p.population,
      coordinate: p.coordinate,
      distanceAlongM: proj.distanceAlongM,
      offsetM: proj.distanceFromLineM,
    });
  }
  return out.sort((a, b) => a.distanceAlongM - b.distanceAlongM);
}

/** Rank for choosing between nearby places: cities > towns > villages, then population. */
export function placeImportance(p: Pick<PlaceAlongRoute, 'kind' | 'population'>): number {
  const base = p.kind === 'city' ? 3 : p.kind === 'town' ? 2 : 1;
  return base * 1e7 + Math.min(9_999_999, p.population ?? 0);
}
