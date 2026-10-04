import type { RouteAvoid, RouteApiRequest, RouteMode } from '../../api/route';
import type { LngLat } from '../../types/geo';
import type { Route } from '../../types/route';
import { fetchJson, isAbortError, ProviderError } from '../http';
import { normalizeOsrmRoute, type OsrmRoute } from './OSRMProvider';
import type { RouteRequest, RoutingCapabilities, RoutingProvider, TravelMatrix } from './RoutingProvider';

/**
 * OUR routing engine (Valhalla — DEVELOPMENT_PLAN DP-6.2, DP-6.3) through the Worker's `/api/v1/route`: car, walking
 * and cycling, alternatives, silent via points, stops, and avoiding tolls, motorways and ferries. The answer is
 * OSRM-shaped (Valhalla's `format: "osrm"`), so the same normaliser builds the app's `Route`.
 *
 * `fallback` (the public OSRM servers, until more regions and the cloud engine exist) answers only when our engine
 * is not running (503) or a point lies outside its graph (422) — never for avoid options it can't honour.
 */
export class ValhallaProvider implements RoutingProvider {
  readonly name = 'valhalla';
  readonly capabilities: RoutingCapabilities = {
    alternatives: true,
    avoid: ['tolls', 'highways', 'ferries'],
    laneGuidance: true,
    matrix: true,
    multiStop: true,
    via: true,
  };

  constructor(
    private readonly url: string,
    private readonly mode: RouteMode,
    private readonly fallback: RoutingProvider | null = null,
    private readonly maxAlternatives = 2,
    private readonly timeoutMs = 20_000,
  ) {}

  private post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
    return fetchJson<T>(`${this.url.replace(/\/$/, '')}${path}`, {
      provider: 'Routing service',
      signal,
      timeoutMs: this.timeoutMs,
      init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    });
  }

  /** Our engine can't answer this (not running, or a point beyond its region): the fallback may. */
  private static elsewhere(e: unknown): boolean {
    return e instanceof ProviderError && (e.status === 503 || e.status === 422 || e.kind === 'network' || e.kind === 'timeout');
  }

  async calculateRoutes(req: RouteRequest): Promise<Route[]> {
    try {
      return await this.ours(req);
    } catch (e) {
      if (isAbortError(e) || !this.fallback || !ValhallaProvider.elsewhere(e) || req.avoid?.length) throw e;
      return this.fallback.calculateRoutes(req);
    }
  }

  private async ours(req: RouteRequest): Promise<Route[]> {
    const via = !req.waypoints?.length ? (req.via ?? []) : [];
    const points: RouteApiRequest['points'] = [
      { lon: req.origin.coordinate[0], lat: req.origin.coordinate[1] },
      ...via.map(([lon, lat]) => ({ lon, lat, via: true })),
      ...(req.waypoints ?? []).map((w) => ({ lon: w.coordinate[0], lat: w.coordinate[1] })),
      { lon: req.destination.coordinate[0], lat: req.destination.coordinate[1] },
    ];
    const body: RouteApiRequest = {
      mode: this.mode,
      points,
      ...(req.alternatives && points.length === 2 ? { alternatives: this.maxAlternatives } : {}),
      ...(req.avoid?.length ? { avoid: req.avoid.filter((a): a is RouteAvoid => this.capabilities.avoid.includes(a)) } : {}),
      ...(req.startBearingDeg !== undefined && Number.isFinite(req.startBearingDeg) ? { bearingDeg: req.startBearingDeg } : {}),
      language: req.language === 'ru' ? 'ru' : 'en',
    };
    let data: { code?: string; routes?: OsrmRoute[] };
    try {
      data = await this.post('', body, req.signal);
    } catch (e) {
      if (e instanceof ProviderError && e.status === 404) throw new ProviderError('No route found', 'no-route', 'Routing service', 404);
      throw e;
    }
    if (data.code !== 'Ok' || !data.routes?.length) throw new ProviderError('No route found', 'no-route', 'Routing service');
    return data.routes.map((r) => ({ ...normalizeOsrmRoute(cleanNames(r), req), provider: 'valhalla' }));
  }

  async travelMatrix(sources: LngLat[], destinations: LngLat[], signal?: AbortSignal): Promise<TravelMatrix> {
    try {
      return await this.post<TravelMatrix>('/matrix', { mode: this.mode, sources, destinations }, signal);
    } catch (e) {
      if (isAbortError(e) || !this.fallback?.travelMatrix || !ValhallaProvider.elsewhere(e)) throw e;
      return this.fallback.travelMatrix(sources, destinations, signal);
    }
  }
}

/** Valhalla joins a road's several names with ";" ("Pushkin St; Pushkinis kucha"): keep the first, as OSRM does. */
function cleanNames(r: OsrmRoute): OsrmRoute {
  return {
    ...r,
    legs: r.legs.map((leg) => ({ ...leg, steps: leg.steps.map((s) => ({ ...s, name: (s.name ?? '').split(';')[0].trim() })) })),
  };
}
