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
  /**
   * Silent via points: the road passes through them, but they are not stops (no
   * arrival, no instruction). Used to look for other roads. Needs `capabilities.via`;
   * not combined with `waypoints` or `alternatives`.
   */
  via?: LngLat[];
  /** Ask for alternative routes (only honoured if the provider supports it). */
  alternatives?: boolean;
  /** Only options listed in `capabilities.avoid` may be passed. */
  avoid?: AvoidOption[];
  /** When the trip starts (UTC ms). Timetabled routers (public transport) need it; road routers ignore it. */
  departAtMs?: number;
  /** Language for names the router gives (stops); road routers ignore it. */
  language?: string;
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
  /** Can route through silent via points (see `RouteRequest.via`). */
  via?: boolean;
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
