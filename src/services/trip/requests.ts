import { apiPaths } from '../../api/v1';
import { positionAtDistance, timeAtDistance } from '../../algorithms/routeTiming';
import type { LocationForecast } from '../../types/weather';
import type { TimedRoute, RouteSample, PlaceAlongRoute } from '../../types/route';
import { encodePolyline } from '../../utils/polyline';
import { resampleRoute, type RouteProfile } from '../../trip/route/profile';
import { hazardCode } from '../../trip/weather/hazards';
import type {
  StopPlaces,
  StopPlacesRequest,
  TripPlan,
  TripPlanRequest,
  TripPreferences,
  TripProgressState,
  TripStop,
  TripWeatherSample,
  VehicleProfile,
} from '../../trip/types';
import { fetchJson } from '../http';

/**
 * Client side of the long-trip planner (ADR-013): turn the app's route,
 * forecasts and settlements into a TripPlanRequest, and call the Worker.
 * Positions sent are the route itself (needed to plan it) — nothing else.
 */

/** The client's own timed route as a planner profile (exact, no resampling). */
export function profileFromTimed(timed: TimedRoute): RouteProfile {
  return {
    points: timed.route.geometry,
    alongM: Array.from(timed.cumDistM),
    timeS: Array.from(timed.cumTimeS),
    totalDistM: timed.totalDistM,
    totalTimeS: timed.totalTimeS,
  };
}

/** Hourly hazard codes for each sample, from forecasts already loaded (≤ `hours` from the hour before departure). */
export function weatherSamples(
  samples: RouteSample[],
  forecastFor: (s: RouteSample) => LocationForecast | undefined,
  departAtMs: number,
  hours = 96,
): TripWeatherSample[] {
  const t0 = Math.floor(departAtMs / 3_600_000) * 3_600_000 - 3_600_000;
  const out: TripWeatherSample[] = [];
  for (const s of samples.slice(0, 200)) {
    const f = forecastFor(s);
    if (!f) continue;
    const h: number[] = [];
    for (let k = 0; k < hours; k++) {
      const i = f.times.indexOf(t0 + k * 3_600_000);
      if (i < 0) {
        h.push(-1);
        continue;
      }
      // Precipitation describes the hour BEFORE its timestamp: take the next hour's value for this hour.
      const next = i + 1 < f.times.length ? i + 1 : i;
      h.push(
        hazardCode({
          condition: f.hourly.condition[i],
          precipitation: f.hourly.precipitation[next],
          temperature: f.hourly.temperature[i],
          windGusts: f.hourly.windGusts[i],
          visibility: f.hourly.visibility[i],
        }),
      );
    }
    while (h.length && h[h.length - 1] === -1) h.pop();
    if (h.length) out.push({ alongM: Math.round(s.distanceM), tz: f.timezone, t0, h });
  }
  return out;
}

export interface TripRequestInput {
  timed: TimedRoute;
  samples: RouteSample[];
  places: PlaceAlongRoute[];
  forecastFor: (s: RouteSample) => LocationForecast | undefined;
  departAtMs: number;
  vehicle: VehicleProfile;
  preferences: TripPreferences;
  locale: string;
  fallbackTz: string;
  progress?: TripProgressState;
  overnightsM?: number[];
}

export function buildTripRequest(input: TripRequestInput): TripPlanRequest {
  const { timed } = input;
  const route = timed.route;
  const resampled = resampleRoute(
    timed.totalDistM,
    (d) => positionAtDistance(timed, d).coordinate,
    (d) => timeAtDistance(timed, d),
  );
  const weather = weatherSamples(input.samples, input.forecastFor, input.progress?.nowMs ?? input.departAtMs);
  const [olon, olat] = route.origin.coordinate;
  const [dlon, dlat] = route.destination.coordinate;
  return {
    version: 1,
    route: {
      id: route.id,
      polyline: resampled.polyline,
      stepM: resampled.stepM,
      timesS: resampled.timesS,
      distanceM: Math.round(timed.totalDistM),
      origin: { name: route.origin.name, lat: olat, lon: olon },
      destination: { name: route.destination.name, lat: dlat, lon: dlon },
      tz: weather[0]?.tz ?? input.fallbackTz,
    },
    departAtMs: input.departAtMs,
    vehicle: input.vehicle,
    preferences: input.preferences,
    places: [...input.places]
      .sort((a, b) => (a.kind === b.kind ? (b.population ?? 0) - (a.population ?? 0) : a.kind === 'city' ? -1 : b.kind === 'city' ? 1 : a.kind === 'town' ? -1 : 1))
      .slice(0, 200)
      .map((p) => ({ name: p.name, kind: p.kind, alongM: Math.round(p.distanceAlongM), lat: p.coordinate[1], lon: p.coordinate[0], ...(p.population ? { population: p.population } : {}) })),
    weather,
    ...(input.progress ? { progress: input.progress } : {}),
    ...(input.overnightsM?.length ? { overnightsM: input.overnightsM } : {}),
    locale: input.locale,
  };
}

export function fetchTripPlan(req: TripPlanRequest, signal?: AbortSignal): Promise<TripPlan> {
  return fetchJson<TripPlan>(apiPaths.tripsPlan, {
    provider: 'Trip planner',
    signal,
    timeoutMs: 15_000,
    init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) },
  });
}

/** Places around one stop: sends the stop and the road ±30 km around it. */
export async function fetchStopPlaces(
  stop: TripStop,
  timed: TimedRoute,
  vehicle: VehicleProfile,
  preferences: TripPreferences,
  locale: string,
  signal?: AbortSignal,
): Promise<StopPlaces[]> {
  const pts = [];
  for (let d = Math.max(0, stop.alongM - 30_000); d <= Math.min(timed.totalDistM, stop.alongM + 30_000); d += 500) pts.push(positionAtDistance(timed, d).coordinate);
  const req: StopPlacesRequest = {
    version: 1,
    stop: { lat: stop.lat, lon: stop.lon, kinds: stop.kinds, arriveMs: stop.arriveMs, tz: stop.tz },
    route: encodePolyline(pts, 5),
    vehicle,
    preferences,
    locale,
  };
  const res = await fetchJson<{ places: StopPlaces[] }>(apiPaths.tripsPlaces, {
    provider: 'Trip planner',
    signal,
    timeoutMs: 25_000,
    init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) },
  });
  return res.places;
}
