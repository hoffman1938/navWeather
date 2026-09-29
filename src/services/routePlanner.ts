import { localizeScript } from '../i18n/script';
import { snapPlacesToRoute } from '../algorithms/placesAlongRoute';
import { nameSamples, refineSamplesForWeather, mergeSamples, sampleRoute } from '../algorithms/routeSampling';
import { buildTimedRoute, positionAtDistance } from '../algorithms/routeTiming';
import { matchForecastToTime } from '../algorithms/weatherMatching';
import { config } from '../config';
import { en, type Messages } from '../i18n/en';
import type { LngLat, Place } from '../types/geo';
import type { ElevationProfile, PlaceAlongRoute, Route, RouteSample, TimedRoute } from '../types/route';
import type { LocationForecast, WeatherAtTime } from '../types/weather';
import { isAbortError, ProviderError } from './http';
import type { Providers } from './providers';
import type { AvoidOption } from './routing/RoutingProvider';
import type { ForecastLookup } from './weather/WeatherService';

export type PlanStage = 'geocoding' | 'routing' | 'places' | 'weather';

export interface PlannedRoute {
  timed: TimedRoute;
  places: PlaceAlongRoute[];
  elevation: ElevationProfile | null;
  samples: RouteSample[];
  /** Non-fatal degradations, e.g. place names unavailable. */
  warnings: string[];
  /** Whether weather-change refinement already ran for this plan. */
  refined: boolean;
  /**
   * Settlements that missed the soft deadline. Resolves later (or to []);
   * the store then names samples without re-sampling or refetching weather.
   */
  latePlaces?: Promise<PlaceAlongRoute[]>;
}

/** How long route planning waits for place names before continuing without them. */
export const PLACES_SOFT_DEADLINE_MS = 3500;

export interface PlaceQuery {
  text: string;
  /** Already-resolved place (picked suggestion / current location). */
  place: Place | null;
}

/** Resolve a user input to a place (skips the network if already resolved). */
export async function resolvePlace(providers: Providers, q: PlaceQuery, signal?: AbortSignal, m: Messages = en): Promise<Place> {
  if (q.place) return q.place;
  const text = q.text.trim();
  if (!text) throw new ProviderError(m.ui.enterPlace, 'not-found', 'Geocoding service');
  const coord = parseCoordinateText(text);
  if (coord) return { id: `coord:${coord.join(',')}`, name: text, label: text, coordinate: coord };
  const place = await providers.geocoding.geocode(text, { signal, language: m.locale });
  if (!place) throw new ProviderError(m.ui.notFound(text), 'not-found', 'Geocoding service');
  return place;
}

/** Accept "41.69, 44.80" style input. */
export function parseCoordinateText(text: string): LngLat | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lon, lat];
}

export interface PlanOptions {
  signal?: AbortSignal;
  startBearingDeg?: number;
  onStage?: (s: PlanStage) => void;
  placesDeadlineMs?: number;
  waypoints?: Place[];
  /** Request alternative routes when the routing provider supports them. */
  alternatives?: boolean;
  avoid?: AvoidOption[];
  /** Language for place names along the route. */
  language?: string;
}

export interface RouteOptionsResult {
  /** Selected (best) route, fully enriched. */
  primary: PlannedRoute;
  /** Alternatives: timed + sampled, place names/elevation loaded on selection. */
  alternatives: PlannedRoute[];
}

/**
 * ROUTE → SAMPLES. Calculates the road route(s), then enriches the best one
 * (settlements + elevation in parallel, both optional) and picks adaptive
 * weather samples. Alternatives get timing + sampling only, so their weather
 * can be compared without extra place/elevation traffic.
 */
export async function planRouteOptions(
  providers: Providers,
  origin: Place,
  destination: Place,
  options: PlanOptions = {},
): Promise<RouteOptionsResult> {
  const { signal, onStage } = options;
  onStage?.('routing');
  const routes = await providers.routing.calculateRoutes({
    origin,
    destination,
    waypoints: options.waypoints,
    startBearingDeg: options.startBearingDeg,
    alternatives: options.alternatives,
    avoid: options.avoid,
    signal,
  });
  const localized = routes.map((r) => localizeRouteNames(r, options.language ?? 'en'));
  const withTraffic = await Promise.all(localized.map((r) => providers.traffic.applyTraffic(r, signal)));
  onStage?.('places');
  const primary = await enrichRoute(providers, withTraffic[0], {
    signal,
    placesDeadlineMs: options.placesDeadlineMs,
    language: options.language,
  });
  const alternatives = withTraffic.slice(1).map((r) => basicPlan(buildTimedRoute(r)));
  return { primary, alternatives };
}

/** Single best route (navigation re-routes, tests). */
export async function planRoute(
  providers: Providers,
  origin: Place,
  destination: Place,
  options: PlanOptions = {},
): Promise<PlannedRoute> {
  return (await planRouteOptions(providers, origin, destination, { ...options, alternatives: false })).primary;
}

/** Street names and road numbers in the UI's script (OSM often has Georgian only). */
export function localizeRouteNames(route: Route, language: string): Route {
  const fix = (s?: string) => (s ? localizeScript(s, language) : s);
  return {
    ...route,
    legs: route.legs.map((leg) => ({
      ...leg,
      steps: leg.steps.map((st) => ({ ...st, name: fix(st.name) ?? '', ref: fix(st.ref), destinations: fix(st.destinations), rotaryName: fix(st.rotaryName) })),
    })),
  };
}

/** Timing + distance/time sampling only (no network). */
export function basicPlan(timed: TimedRoute): PlannedRoute {
  const samples = sampleRoute({ timed, maxIntervalMinutes: config.sampling.maxIntervalMinutes });
  return { timed, places: [], elevation: null, samples, warnings: ['not-enriched'], refined: false };
}

/**
 * Settlements (soft deadline) + elevation in parallel, then adaptive
 * sampling anchored on them. Used for the primary route and when the user
 * picks an alternative.
 */
export async function enrichRoute(
  providers: Providers,
  route: Route,
  options: { signal?: AbortSignal; placesDeadlineMs?: number; language?: string } = {},
): Promise<PlannedRoute> {
  const { signal } = options;
  const timed = buildTimedRoute(route);
  const warnings: string[] = [];
  const totalKm = timed.totalDistM / 1000;
  // Places are a nicety (names + anchors) — never let a slow server block the forecast.
  const placesPromise: Promise<PlaceAlongRoute[]> = providers.places
    ? withTimeout(
        providers.places.getPlacesNearRoute(route.geometry, { includeVillages: totalKm < 80, signal, language: options.language }),
        25000,
      ).then(
        (raw) => snapPlacesToRoute(raw, timed),
      )
    : Promise.resolve([]);
  placesPromise.catch(() => undefined);
  const [placesRes, elevRes] = await Promise.all([
    settleWithin(placesPromise, options.placesDeadlineMs ?? PLACES_SOFT_DEADLINE_MS),
    settleWithin(providers.elevation ? loadElevationProfile(providers, timed, signal) : Promise.resolve(null), 8000),
  ]);
  if (signal?.aborted) throw new ProviderError('Request aborted', 'aborted', 'Planner');

  let places: PlaceAlongRoute[] = [];
  let latePlaces: Promise<PlaceAlongRoute[]> | undefined;
  if (placesRes.status === 'fulfilled') places = placesRes.value;
  else if (placesRes.status === 'pending') latePlaces = placesPromise.catch(() => []);
  else warnings.push('places-unavailable');
  const elevation = elevRes.status === 'fulfilled' ? elevRes.value : null;
  if (elevRes.status !== 'fulfilled') warnings.push('elevation-unavailable');

  const raw = sampleRoute({
    timed,
    places,
    elevation,
    maxIntervalMinutes: config.sampling.maxIntervalMinutes,
  });
  const samples = nameSamples(raw, places, Math.max(6000, timed.totalDistM / 25));
  return { timed, places, elevation, samples, warnings, refined: false, latePlaces };
}

/**
 * Name samples with settlements that arrived after planning. OSM settlement
 * names replace reverse-geocoded ones; ids (and so forecasts) are unchanged.
 */
export function applyLatePlaces(plan: PlannedRoute, places: PlaceAlongRoute[]): PlannedRoute {
  if (places.length === 0) return { ...plan, latePlaces: undefined };
  const radius = Math.max(6000, plan.timed.totalDistM / 25);
  const candidates = plan.samples.map((s) =>
    s.placeKind || s.reasons.includes('origin') || s.reasons.includes('destination')
      ? s
      : { ...s, placeName: undefined, placeRelation: undefined },
  );
  const named = nameSamples(candidates, places, radius);
  const samples = named.map((s, i) => (s.placeName ? s : plan.samples[i]));
  return { ...plan, places, samples, latePlaces: undefined };
}

type Settled<T> = { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown } | { status: 'pending' };

/** Wait at most `ms` for a promise; report whether it settled. */
function settleWithin<T>(p: Promise<T>, ms: number): Promise<Settled<T>> {
  return Promise.race([
    p.then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason) => ({ status: 'rejected' as const, reason }),
    ),
    new Promise<Settled<T>>((resolve) => setTimeout(() => resolve({ status: 'pending' }), ms)),
  ]);
}

async function loadElevationProfile(
  providers: Providers,
  timed: TimedRoute,
  signal?: AbortSignal,
): Promise<ElevationProfile | null> {
  if (!providers.elevation) return null;
  const n = Math.max(20, Math.min(100, Math.round(timed.totalDistM / 2500)));
  const distancesM = Array.from({ length: n }, (_, i) => (timed.totalDistM * i) / (n - 1));
  const coords = distancesM.map((d) => positionAtDistance(timed, d).coordinate);
  const elevationsM = await withTimeout(providers.elevation.getElevations(coords, signal), 10000);
  return { distancesM, elevationsM };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ProviderError('Timed out', 'timeout', 'Planner')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Forecast lookup for a sample via the weather service's spatial key. */
export function forecastLookupFn(
  providers: Providers,
  forecasts: Map<string, LocationForecast> | Record<string, LocationForecast>,
) {
  const get =
    forecasts instanceof Map ? (k: string) => forecasts.get(k) : (k: string) => (forecasts as Record<string, LocationForecast>)[k];
  return (s: RouteSample) => get(providers.weather.keyFor(s.coordinate[1], s.coordinate[0]));
}

/** Fetch forecasts for all samples, covering the latest arrival. */
export function fetchSampleForecasts(
  providers: Providers,
  samples: RouteSample[],
  latestArrivalMs: number,
  options: { force?: boolean; signal?: AbortSignal } = {},
): Promise<ForecastLookup> {
  return providers.weather.getForecasts(
    samples.map((s) => ({ latitude: s.coordinate[1], longitude: s.coordinate[0] })),
    { needUntilMs: latestArrivalMs + 3600_000, force: options.force, signal: options.signal },
  );
}

/**
 * Weather-driven refinement: where neighbouring samples' forecasts (at
 * their arrival times) differ a lot, add midpoints and fetch them too.
 */
export async function refinePlanWithWeather(
  providers: Providers,
  plan: PlannedRoute,
  arrivalFor: (s: RouteSample) => number,
  forecasts: Map<string, LocationForecast>,
  signal?: AbortSignal,
): Promise<{ plan: PlannedRoute; lookup: ForecastLookup | null }> {
  const lookupFn = forecastLookupFn(providers, forecasts);
  const weatherById = new Map<string, WeatherAtTime | null>();
  for (const s of plan.samples) {
    const f = lookupFn(s);
    weatherById.set(s.id, f ? matchForecastToTime(f, arrivalFor(s)) : null);
  }
  const extra = refineSamplesForWeather(plan.samples, weatherById, plan.timed, {
    maxAdditional: config.sampling.maxRefinementPoints,
    minGapM: Math.max(2000, plan.timed.totalDistM / 120),
    elevation: plan.elevation,
  });
  if (extra.length === 0) return { plan: { ...plan, refined: true }, lookup: null };
  const named = nameSamples(extra, plan.places, Math.max(6000, plan.timed.totalDistM / 25));
  try {
    const lookup = await fetchSampleForecasts(
      providers,
      named,
      Math.max(...named.map(arrivalFor)),
      { signal },
    );
    return { plan: { ...plan, samples: mergeSamples(plan.samples, named), refined: true }, lookup };
  } catch (e) {
    if (isAbortError(e)) throw e;
    return { plan: { ...plan, refined: true }, lookup: null };
  }
}

/** Human-friendly, localized error text for the UI. */
export function describeError(e: unknown, fallback: string, m: Messages = en): string {
  if (e instanceof ProviderError) {
    if (e.kind === 'no-route') return m.ui.noRoadRoute;
    if (e.kind === 'not-found') return e.message;
    // Free public servers: overload and brief outages pass — say so rather than a bare failure.
    if (e.kind === 'rate-limited' || (e.kind === 'http' && (e.status ?? 0) >= 500)) return `${fallback} — ${m.ui.busyService}`;
    if (e.kind === 'timeout' || e.kind === 'network') return `${fallback} — ${m.ui.checkConnection}`;
  }
  return fallback;
}
