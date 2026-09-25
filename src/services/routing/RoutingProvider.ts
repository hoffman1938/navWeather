import type { LngLat, Place } from '../../types/geo';
import type { Route } from '../../types/route';

export type AvoidOption = 'tolls' | 'highways' | 'ferries';

export interface RouteRequest {
  origin: Place;
  destination: Place;
  /** Intermediate stops, visited in order. */
  waypoints?: Place[];
  /** Current heading, used when re-routing a moving vehicle to avoid U-turns. */
  startBearingDeg?: number;
  /** Ask for alternative routes (only honoured if the provider supports it). */
  alternatives?: boolean;
  /** Only options listed in `capabilities.avoid` may be passed. */
  avoid?: AvoidOption[];
  signal?: AbortSignal;
}

/** What the provider can actually do — the UI only offers these. */
export interface RoutingCapabilities {
  alternatives: boolean;
  avoid: AvoidOption[];
  laneGuidance: boolean;
  /** Travel-time matrix (used for real detour times to places along the route). */
  matrix: boolean;
  multiStop: boolean;
}

export interface TravelMatrix {
  /** seconds[source][destination]; null when unreachable. */
  durations: (number | null)[][];
  /** metres[source][destination]; null when unreachable. */
  distances: (number | null)[][];
}

/**
 * Routing provider contract. Implementations must return normalized
 * `Route` objects with full road geometry and the finest-grained segment
 * durations they have (per-edge annotations > steps > whole route).
 */
export interface RoutingProvider {
  readonly name: string;
  readonly capabilities: RoutingCapabilities;
  /** Best route first, then alternatives (if requested and available). */
  calculateRoutes(request: RouteRequest): Promise<Route[]>;
  /** Durations/distances from each source to each destination. */
  travelMatrix?(sources: LngLat[], destinations: LngLat[], signal?: AbortSignal): Promise<TravelMatrix>;
}
