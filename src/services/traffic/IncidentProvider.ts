import type { LngLat } from '../../types/geo';
import type { Route } from '../../types/route';

export type IncidentKind = 'accident' | 'closure' | 'roadworks' | 'congestion' | 'hazard' | 'weather';

/**
 * A road incident from a provider (official feed or user reports), already
 * normalized. `verified` separates confirmed data from unconfirmed reports —
 * reports are never presented as fact.
 */
export interface Incident {
  id: string;
  kind: IncidentKind;
  coordinate: LngLat;
  severity: 'critical' | 'high' | 'medium' | 'low';
  verified: boolean;
  /** Provider / feed name, shown as the source. */
  source: string;
  reportedAt: number;
  /** UTC ms; unknown when omitted. Expired incidents are dropped. */
  expiresAt?: number;
  description?: string;
}

export interface IncidentProvider {
  readonly name: string;
  /** Incidents on or near the route. */
  getIncidents(route: Route, signal?: AbortSignal): Promise<Incident[]>;
}

/**
 * No free, reliable incident source exists for the prototype, so the default
 * returns nothing: the app stays silent rather than inventing hazards.
 */
export class NoIncidentProvider implements IncidentProvider {
  readonly name = 'none';
  async getIncidents(): Promise<Incident[]> {
    return [];
  }
}
