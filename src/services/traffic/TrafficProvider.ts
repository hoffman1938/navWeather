import type { Route } from '../../types/route';

/**
 * Live-traffic hook. A real provider sets `currentDurationS` on route
 * segments; route timing, ETAs and weather matching then follow
 * automatically. The free prototype ships without live traffic.
 */
export interface TrafficProvider {
  readonly name: string;
  applyTraffic(route: Route, signal?: AbortSignal): Promise<Route>;
}

export class NoTrafficProvider implements TrafficProvider {
  readonly name = 'none';
  async applyTraffic(route: Route): Promise<Route> {
    return route;
  }
}
