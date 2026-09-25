import type { LngLat } from '../types/geo';
import type { RouteSample } from '../types/route';
import type { LocationForecast, RouteWeatherPoint, WeatherAtTime } from '../types/weather';
import { formatLocalTime, isValidTimeZone } from '../utils/timezone';
import { HOUR_MS } from '../utils/time';
import { distanceAtTime, positionAtDistance } from './routeTiming';
import { forecastConfidence, matchForecastToTime } from './weatherMatching';

export interface BuildPointsInput {
  samples: RouteSample[];
  /** Estimated arrival (UTC ms) per sample, same order. */
  arrivals: number[];
  forecastFor: (sample: RouteSample) => LocationForecast | undefined;
  /** Clock for lead-time/confidence (real or simulated now). */
  nowMs: number;
  /** Vehicle position along the route, or null while planning. */
  progressM: number | null;
  /** Route model time at the vehicle (0 while planning). */
  modelTimeS: number;
  /** Used when no forecast (hence no location timezone) is available. */
  fallbackTimeZone: string;
}

/**
 * LOCATION + ETA + FORECAST → RouteWeatherPoint.
 * Each sample's forecast is matched to *its own* estimated arrival time.
 */
export function buildRouteWeatherPoints(input: BuildPointsInput): RouteWeatherPoint[] {
  const { samples, arrivals, nowMs, progressM, modelTimeS } = input;
  return samples.map((s, i) => {
    const arrivalMs = arrivals[i];
    const forecast = input.forecastFor(s);
    const timezone = forecast && isValidTimeZone(forecast.timezone) ? forecast.timezone : input.fallbackTimeZone;
    const weather = forecast ? matchForecastToTime(forecast, arrivalMs) : null;
    const leadHours = Math.max(0, (arrivalMs - nowMs) / HOUR_MS);
    const passed = progressM !== null && s.distanceM < progressM - 30;
    return {
      id: s.id,
      latitude: s.coordinate[1],
      longitude: s.coordinate[0],
      distanceFromStartKm: Math.round(s.distanceM / 100) / 10,
      estimatedTravelMinutes: Math.round((progressM === null ? s.travelTimeS : s.travelTimeS - modelTimeS) / 60),
      estimatedArrivalUtc: new Date(arrivalMs).toISOString(),
      arrivalMs,
      localTime: formatLocalTime(arrivalMs, timezone),
      timezone,
      placeName: s.placeName,
      placeRelation: s.placeRelation,
      placeKind: s.placeKind,
      elevationM: s.elevationM,
      weather,
      forecastLeadHours: Math.round(leadHours * 10) / 10,
      confidence: forecastConfidence(leadHours),
      status: passed ? 'passed' : 'upcoming',
      reasons: s.reasons,
    };
  });
}

/**
 * Weather right now at the vehicle: the nearest sample's forecast matched to
 * the current time (no spatial interpolation between distant places).
 */
export function buildCurrentPoint(args: {
  coordinate: LngLat;
  distanceAlongM: number;
  samples: RouteSample[];
  forecastFor: (sample: RouteSample) => LocationForecast | undefined;
  nowMs: number;
  fallbackTimeZone: string;
}): RouteWeatherPoint | null {
  const { samples, distanceAlongM, nowMs } = args;
  if (samples.length === 0) return null;
  let nearest = samples[0];
  for (const s of samples) {
    if (Math.abs(s.distanceM - distanceAlongM) < Math.abs(nearest.distanceM - distanceAlongM)) nearest = s;
  }
  const forecast = args.forecastFor(nearest);
  const timezone = forecast && isValidTimeZone(forecast.timezone) ? forecast.timezone : args.fallbackTimeZone;
  const close = Math.abs(nearest.distanceM - distanceAlongM) < 2000;
  return {
    id: 'current',
    latitude: args.coordinate[1],
    longitude: args.coordinate[0],
    distanceFromStartKm: Math.round(distanceAlongM / 100) / 10,
    estimatedTravelMinutes: 0,
    estimatedArrivalUtc: new Date(nowMs).toISOString(),
    arrivalMs: nowMs,
    localTime: formatLocalTime(nowMs, timezone),
    timezone,
    placeName: nearest.placeName,
    placeRelation: close ? nearest.placeRelation : 'near',
    placeKind: nearest.placeKind,
    elevationM: undefined,
    weather: forecast ? matchForecastToTime(forecast, nowMs) : null,
    forecastLeadHours: 0,
    confidence: 'high',
    status: 'current',
    reasons: [],
  };
}

function weatherEqual(a: WeatherAtTime | null, b: WeatherAtTime | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a) as (keyof WeatherAtTime)[];
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[k] === b[k]);
}

function pointEqual(a: RouteWeatherPoint, b: RouteWeatherPoint): boolean {
  return (
    a.id === b.id &&
    // Minute resolution: sub-minute ETA drift must not re-render cards.
    Math.round(a.arrivalMs / 60000) === Math.round(b.arrivalMs / 60000) &&
    a.localTime === b.localTime &&
    a.estimatedTravelMinutes === b.estimatedTravelMinutes &&
    a.status === b.status &&
    a.placeName === b.placeName &&
    a.confidence === b.confidence &&
    a.timezone === b.timezone &&
    weatherEqual(a.weather, b.weather)
  );
}

/**
 * Structural sharing: reuse previous point objects that did not change so
 * memoized cards/markers skip re-rendering after refreshes and ETA ticks.
 */
export function reconcilePoints(
  prev: RouteWeatherPoint[] | undefined,
  next: RouteWeatherPoint[],
): RouteWeatherPoint[] {
  if (!prev || prev.length === 0) return next;
  const byId = new Map(prev.map((p) => [p.id, p]));
  let changed = prev.length !== next.length;
  const out = next.map((p, i) => {
    const old = byId.get(p.id);
    if (old && pointEqual(old, p)) {
      if (prev[i] !== old) changed = true;
      return old;
    }
    changed = true;
    return p;
  });
  return changed ? out : prev;
}

/** Meaningful forecast differences between two versions of the same points. */
export function diffForecast(prev: RouteWeatherPoint[], next: RouteWeatherPoint[]): string[] {
  const byId = new Map(prev.map((p) => [p.id, p]));
  const changed: string[] = [];
  for (const p of next) {
    const old = byId.get(p.id);
    if (!old || !old.weather || !p.weather) continue;
    const a = old.weather;
    const b = p.weather;
    if (
      a.condition !== b.condition ||
      Math.abs(a.temperature - b.temperature) >= 1 ||
      Math.abs((a.precipitationProbability ?? 0) - (b.precipitationProbability ?? 0)) >= 10
    ) {
      changed.push(p.id);
    }
  }
  return changed;
}

export interface RouteStateAtTime {
  atMs: number;
  coordinate: LngLat;
  distanceM: number;
  /** Travel time from the route start (s). */
  travelTimeS: number;
  placeName?: string;
  placeRelation?: 'in' | 'near';
  weather: WeatherAtTime | null;
  timezone: string;
  localTime: string;
  /** Clamped to the destination (the requested time is after arrival). */
  arrived: boolean;
}

/**
 * "Where will the driver be at 10:30, and what weather is expected there then?"
 * Position comes from route timing; weather is the NEAREST sample's forecast
 * matched to that exact time (no interpolation between distant places).
 */
export function routeStateAtTime(args: {
  timed: import('../types/route').TimedRoute;
  samples: RouteSample[];
  forecastFor: (sample: RouteSample) => LocationForecast | undefined;
  atMs: number;
  clock: { mode: 'planning'; departureMs: number } | { mode: 'navigating'; nowMs: number; modelTimeS: number };
  fallbackTimeZone: string;
}): RouteStateAtTime | null {
  const { timed, samples, atMs, clock } = args;
  if (samples.length === 0) return null;
  const raw =
    clock.mode === 'planning'
      ? (atMs - clock.departureMs) / 1000
      : clock.modelTimeS + (atMs - clock.nowMs) / 1000;
  const minT = clock.mode === 'planning' ? 0 : clock.modelTimeS;
  const travelTimeS = Math.max(minT, Math.min(timed.totalTimeS, raw));
  const distanceM = distanceAtTime(timed, travelTimeS);
  const { coordinate } = positionAtDistance(timed, distanceM);
  let nearest = samples[0];
  for (const s of samples) {
    if (Math.abs(s.distanceM - distanceM) < Math.abs(nearest.distanceM - distanceM)) nearest = s;
  }
  const forecast = args.forecastFor(nearest);
  const timezone = forecast && isValidTimeZone(forecast.timezone) ? forecast.timezone : args.fallbackTimeZone;
  const close = Math.abs(nearest.distanceM - distanceM) < 2000;
  return {
    atMs,
    coordinate,
    distanceM,
    travelTimeS,
    placeName: nearest.placeName,
    placeRelation: close ? nearest.placeRelation : nearest.placeName ? 'near' : undefined,
    weather: forecast ? matchForecastToTime(forecast, atMs) : null,
    timezone,
    localTime: formatLocalTime(atMs, timezone),
    arrived: raw >= timed.totalTimeS,
  };
}
