import { localizeScript } from '../i18n/script';
import { doublesBack, otherDistinctRoutes, probePoints, selectDistinctRoutes } from '../algorithms/routeAlternatives';
import { snapPlacesToRoute } from '../algorithms/placesAlongRoute';
import { nameSamples, refineSamplesForWeather, mergeSamples, sampleRoute } from '../algorithms/routeSampling';
import { buildTimedRoute, positionAtDistance } from '../algorithms/routeTiming';
import { matchForecastToTime } from '../algorithms/weatherMatching';
import { config } from '../config';
import { en, type Messages } from '../i18n/en';
import type { LngLat, Place } from '../types/geo';
import type { ElevationProfile, PlaceAlongRoute, Route, RouteSample, TimedRoute } from '../types/route';
import type { LocationForecast, WeatherAtTime } from '../types/weather';
import { isAbortError, mapWithConcurrency, ProviderError } from './http';
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
  /** Most roads to offer, the best one included (default: config). */
  maxRoutes?: number;
  /** When the trip starts (UTC ms): public transport is planned on the timetable from then. */
  departAtMs?: number;
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
  const language = options.language ?? 'en';
  onStage?.('routing');
  const routes = await providers.routing.calculateRoutes({
    origin,
    destination,
    waypoints: options.waypoints,
    startBearingDeg: options.startBearingDeg,
    alternatives: options.alternatives,
    avoid: options.avoid,
    departAtMs: options.departAtMs,
    language,
    signal,
  });
  // Only genuinely different roads: routers return near-copies of the best route. Public-transport trips are
  // different departures and lines, often on the same streets — each is a choice of its own.
  const maxRoutes = options.alternatives ? (options.maxRoutes ?? config.routing.maxRoutes) : 1;
  const timetabled = routes.some((r) => r.transit);
  const distinct = timetabled ? routes.slice(0, maxRoutes) : selectDistinctRoutes(routes, { max: maxRoutes });
  // Routers often find no alternative at all. Look for more roads in the background, while the best one's
  // place names and elevation load, so choosing between roads costs almost no extra waiting.
  const probing =
    options.alternatives && !options.waypoints?.length && distinct.length < maxRoutes
      ? findViaRoutes(providers, distinct[0], origin, destination, { signal, startBearingDeg: options.startBearingDeg })
      : Promise.resolve<Route[]>([]);
  const best = await providers.traffic.applyTraffic(localizeRouteNames(distinct[0], language), signal);
  onStage?.('places');
  const primary = await enrichRoute(providers, best, {
    signal,
    placesDeadlineMs: options.placesDeadlineMs,
    language: options.language,
  });
  const viaRoutes = await probing;
  if (signal?.aborted) throw new ProviderError('Request aborted', 'aborted', 'Planner');
  const others = !options.alternatives
    ? []
    : timetabled
      ? distinct.slice(1)
      : otherDistinctRoutes(distinct[0], [...distinct.slice(1), ...viaRoutes], { max: maxRoutes - 1 });
  const alternatives = await Promise.all(
    others.map(async (r) => basicPlan(buildTimedRoute(await providers.traffic.applyTraffic(localizeRouteNames(r, language), signal)))),
  );
  return { primary, alternatives };
}

/** Is a road found through a via point a believable way to go, not a detour for its own sake? */
function believable(route: Route, primary: Route): boolean {
  return route.durationS <= primary.durationS * 1.5 && route.distanceM <= primary.distanceM * 1.6 && doublesBack(route) < 0.04;
}

/** How long to wait for roads found through via points before showing what there is. */
export const VIA_PROBE_DEADLINE_MS = 6000;

/**
 * Roads a router would not offer by itself: ask it for routes THROUGH points
 * off the main road, and keep the believable ones. Best effort — a point with
 * no road near it is the normal case, and after the deadline whatever has come
 * back is used. Needs a provider that can route through silent via points.
 */
export async function findViaRoutes(
  providers: Providers,
  primary: Route,
  origin: Place,
  destination: Place,
  options: { signal?: AbortSignal; startBearingDeg?: number; deadlineMs?: number } = {},
): Promise<Route[]> {
  if (!providers.routing.capabilities.via) return [];
  const ctrl = new AbortController();
  const found: Route[] = [];
  let closed = false;
  let stop: () => void = () => undefined;
  // Whichever comes first ends the wait — the probes finishing, the caller giving up, or the deadline —
  // even if a provider ignores the abort signal.
  const ended = new Promise<void>((resolve) => (stop = resolve));
  const onAbort = () => {
    ctrl.abort();
    stop();
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(onAbort, options.deadlineMs ?? VIA_PROBE_DEADLINE_MS);
  try {
    const probes = mapWithConcurrency(probePoints(primary), 2, async (point) => {
      try {
        const [route] = await providers.routing.calculateRoutes({
          origin,
          destination,
          via: [point],
          startBearingDeg: options.startBearingDeg,
          signal: ctrl.signal,
        });
        if (!closed && route && believable(route, primary)) found.push(route);
      } catch {
        /* no road there, router busy, deadline: this probe adds nothing */
      }
    });
    await Promise.race([probes, ended]);
  } finally {
    closed = true;
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
  return [...found];
}

/**
 * Roads from `origin` to the destination that are really different from
 * `reference` (the road already taken): timed + sampled only, with place
 * names and elevation added when one is chosen. Used while driving, after the
 * driver turned onto a new road.
 */
export async function planOtherRoads(
  providers: Providers,
  origin: Place,
  destination: Place,
  options: { reference: Route; signal?: AbortSignal; startBearingDeg?: number; language?: string; maxRoads?: number },
): Promise<PlannedRoute[]> {
  const { signal, reference } = options;
  const max = options.maxRoads ?? Math.max(0, config.routing.maxRoutes - 1);
  const routes = await providers.routing.calculateRoutes({
    origin,
    destination,
    startBearingDeg: options.startBearingDeg,
    alternatives: true,
    signal,
  });
  let others = otherDistinctRoutes(reference, routes, { max });
  if (others.length < max) {
    const viaRoutes = await findViaRoutes(providers, reference, origin, destination, { signal, startBearingDeg: options.startBearingDeg });
    others = otherDistinctRoutes(reference, [...routes, ...viaRoutes], { max });
  }
  const localized = others.map((r) => localizeRouteNames(r, options.language ?? 'en'));
  const withTraffic = await Promise.all(localized.map((r) => providers.traffic.applyTraffic(r, signal)));
  return withTraffic.map((r) => basicPlan(buildTimedRoute(r)));
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

/** Street names, road numbers and stop / headsign names in the UI's script (OSM and GTFS often have Georgian only). */
export function localizeRouteNames(route: Route, language: string): Route {
  const fix = (s?: string) => (s ? localizeScript(s, language) : s);
  const transit = route.transit && {
    ...route.transit,
    legs: route.transit.legs.map((l) => ({ ...l, fromName: fix(l.fromName) ?? '', toName: fix(l.toName) ?? '', headsign: fix(l.headsign) })),
  };
  return {
    ...route,
    ...(transit ? { transit } : {}),
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
  options: {
    signal?: AbortSignal;
    placesDeadlineMs?: number;
    language?: string;
    /** Keep this timed route (same object) instead of building a new one — work tied to it stays valid. */
    timed?: TimedRoute;
  } = {},
): Promise<PlannedRoute> {
  const { signal } = options;
  const timed = options.timed ?? buildTimedRoute(route);
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
