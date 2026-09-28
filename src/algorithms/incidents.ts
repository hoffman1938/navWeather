import type { Incident } from '../services/traffic/IncidentProvider';
import type { TimedRoute } from '../types/route';
import { createRouteProjector } from './placesAlongRoute';

export interface RouteIncident extends Incident {
  /** Where along the route it is (m from start). */
  distanceAlongM: number;
}

/** Keep incidents on the route itself (within `maxOffRouteM`), placed by distance. */
export function snapIncidentsToRoute(incidents: Incident[], timed: TimedRoute, maxOffRouteM = 150): RouteIncident[] {
  if (!incidents.length) return [];
  const project = createRouteProjector(timed);
  const out: RouteIncident[] = [];
  for (const inc of incidents) {
    const p = project(inc.coordinate);
    if (p.distanceFromLineM > maxOffRouteM) continue;
    out.push({ ...inc, distanceAlongM: p.distanceAlongM });
  }
  return out.sort((a, b) => a.distanceAlongM - b.distanceAlongM);
}
