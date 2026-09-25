import type { Place } from '../../types/geo';
import type { Route } from '../../types/route';

export interface RouteRequest {
  origin: Place;
  destination: Place;
  /** Current heading, used when re-routing a moving vehicle to avoid U-turns. */
  startBearingDeg?: number;
  signal?: AbortSignal;
}

/**
 * Routing provider contract. Implementations must return normalized
 * `Route` objects with full road geometry and the finest-grained segment
 * durations they have (per-edge annotations > steps > whole route).
 */
export interface RoutingProvider {
  readonly name: string;
  calculateRoute(request: RouteRequest): Promise<Route>;
}
