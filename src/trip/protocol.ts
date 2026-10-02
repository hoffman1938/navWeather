import { DEFAULT_TRIP_PREFERENCES } from './config';
import type { FoodPreference, StopKind, StopPlacesRequest, TripPace, TripPlaceRef, TripPlanRequest, TripPreferences, TripProgressState, TripWeatherSample, VehicleProfile } from './types';

/**
 * Validation for POST /api/v1/trips/plan (shared: the Worker uses it, tests
 * pin it). Rejects anything malformed or oversized; strips control and
 * bidi characters from names; caps every array.
 */

export const MAX_TRIP_BODY_BYTES = 400_000;
const MAX_POINTS = 5001;
const MAX_PLACES = 200;
const MAX_SAMPLES = 200;
const MAX_HOURS = 400;
const DAY = 86_400_000;

const isNum = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

function cleanName(v: unknown, max = 120): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return s;
}

function endpoint(v: unknown): { name: string; lat: number; lon: number } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const name = cleanName(o.name);
  if (name === null || !isNum(o.lat, -90, 90) || !isNum(o.lon, -180, 180)) return null;
  return { name, lat: o.lat, lon: o.lon };
}

function tz(v: unknown): string | undefined {
  return typeof v === 'string' && /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(v) && v.length <= 64 ? v : undefined;
}

export function sanitizeVehicle(v: unknown): VehicleProfile {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const kind = (['car', 'van', 'truck', 'motorcycle'] as const).find((k) => k === o.kind) ?? 'car';
  const powertrain = o.powertrain === 'ev' ? 'ev' : 'fuel';
  return {
    kind,
    powertrain,
    ...(isNum(o.rangeKm, 1, 5000) ? { rangeKm: o.rangeKm } : {}),
    ...(isNum(o.fullRangeKm, 10, 5000) ? { fullRangeKm: o.fullRangeKm } : {}),
  };
}

export function sanitizePreferences(v: unknown): TripPreferences {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const pace = (['relaxed', 'balanced', 'fast'] as TripPace[]).find((p) => p === o.pace) ?? DEFAULT_TRIP_PREFERENCES.pace;
  const stars = o.hotelMinStars === 3 || o.hotelMinStars === 4 ? o.hotelMinStars : 0;
  const food = (['any', 'restaurant', 'fast_food', 'cafe'] as FoodPreference[]).find((f) => f === o.food) ?? 'any';
  const brand = cleanName(o.fuelBrand, 40);
  return {
    pace,
    hotelMinStars: stars,
    hotelMaxDetourKm: isNum(o.hotelMaxDetourKm, 1, 50) ? o.hotelMaxDetourKm : DEFAULT_TRIP_PREFERENCES.hotelMaxDetourKm,
    food,
    fuelBrand: brand ? brand : null,
  };
}

export function sanitizeTripRequest(raw: unknown, nowMs: number): TripPlanRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return null;
  const route = r.route as Record<string, unknown> | undefined;
  if (!route || typeof route !== 'object') return null;
  const id = typeof route.id === 'string' && route.id.length <= 200 ? route.id : null;
  const polyline = typeof route.polyline === 'string' && route.polyline.length <= 200_000 && /^[\x3f-\x7e]*$/.test(route.polyline) ? route.polyline : null;
  const times = Array.isArray(route.timesS) && route.timesS.length >= 2 && route.timesS.length <= MAX_POINTS && route.timesS.every((t) => isNum(t, 0, 30 * 86400)) ? (route.timesS as number[]) : null;
  const origin = endpoint(route.origin);
  const destination = endpoint(route.destination);
  if (!id || !polyline || !times || !origin || !destination) return null;
  if (!isNum(route.stepM, 100, 10_000) || !isNum(route.distanceM, 1, 25_000_000)) return null;
  if (!isNum(r.departAtMs, nowMs - 2 * DAY, nowMs + 16 * DAY)) return null;

  const places: TripPlaceRef[] = [];
  if (Array.isArray(r.places)) {
    for (const p of r.places.slice(0, MAX_PLACES)) {
      if (!p || typeof p !== 'object') continue;
      const o = p as Record<string, unknown>;
      const name = cleanName(o.name);
      const kind = (['city', 'town', 'village'] as const).find((k) => k === o.kind);
      if (!name || !kind || !isNum(o.alongM, 0, 25_000_000) || !isNum(o.lat, -90, 90) || !isNum(o.lon, -180, 180)) continue;
      places.push({ name, kind, alongM: o.alongM, lat: o.lat, lon: o.lon, ...(isNum(o.population, 0, 50_000_000) ? { population: o.population } : {}) });
    }
  }

  const weather: TripWeatherSample[] = [];
  if (Array.isArray(r.weather)) {
    for (const w of r.weather.slice(0, MAX_SAMPLES)) {
      if (!w || typeof w !== 'object') continue;
      const o = w as Record<string, unknown>;
      const zone = tz(o.tz);
      if (!zone || !isNum(o.alongM, 0, 25_000_000) || !isNum(o.t0, nowMs - 3 * DAY, nowMs + 17 * DAY) || !Array.isArray(o.h)) continue;
      const h = o.h.slice(0, MAX_HOURS).map((c) => (Number.isInteger(c) && (c as number) >= -1 && (c as number) <= 7 ? (c as number) : -1));
      weather.push({ alongM: o.alongM, tz: zone, t0: o.t0, h });
    }
  }

  let progress: TripProgressState | undefined;
  if (r.progress && typeof r.progress === 'object') {
    const o = r.progress as Record<string, unknown>;
    if (isNum(o.alongM, 0, 25_000_000) && isNum(o.nowMs, nowMs - DAY, nowMs + DAY) && isNum(o.drivenTodayS, 0, 2 * 86400) && isNum(o.sinceRestS, 0, 2 * 86400)) {
      progress = { alongM: o.alongM, nowMs: o.nowMs, drivenTodayS: o.drivenTodayS, sinceRestS: o.sinceRestS, ...(isNum(o.rangeKm, 0, 5000) ? { rangeKm: o.rangeKm } : {}) };
    }
  }

  const overnightsM = Array.isArray(r.overnightsM)
    ? r.overnightsM.filter((m): m is number => isNum(m, 1, route.distanceM as number)).slice(0, 6)
    : [];

  return {
    version: 1,
    route: { id, polyline, stepM: route.stepM, timesS: times, distanceM: route.distanceM, origin, destination, ...(tz(route.tz) ? { tz: tz(route.tz) } : {}) },
    ...(overnightsM.length ? { overnightsM } : {}),
    departAtMs: r.departAtMs,
    vehicle: sanitizeVehicle(r.vehicle),
    preferences: sanitizePreferences(r.preferences),
    places,
    weather,
    ...(progress ? { progress } : {}),
    includePlaces: r.includePlaces !== false,
    locale: r.locale === 'ru' ? 'ru' : 'en',
  };
}

export const MAX_STOP_PLACES_BODY_BYTES = 40_000;
const STOP_KINDS: StopKind[] = ['rest', 'meal', 'fuel', 'charge', 'overnight'];

export function sanitizeStopPlacesRequest(raw: unknown, nowMs: number): StopPlacesRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return null;
  const stop = r.stop as Record<string, unknown> | undefined;
  if (!stop || typeof stop !== 'object') return null;
  const kinds = Array.isArray(stop.kinds) ? [...new Set(stop.kinds.filter((k): k is StopKind => STOP_KINDS.includes(k as StopKind)))] : [];
  const zone = tz(stop.tz);
  if (!kinds.length || !zone || !isNum(stop.lat, -90, 90) || !isNum(stop.lon, -180, 180) || !isNum(stop.arriveMs, nowMs - 2 * DAY, nowMs + 17 * DAY)) return null;
  const route = typeof r.route === 'string' && r.route.length <= 20_000 && /^[\x3f-\x7e]*$/.test(r.route) ? r.route : null;
  if (route === null) return null;
  return {
    version: 1,
    stop: { lat: stop.lat, lon: stop.lon, kinds, arriveMs: stop.arriveMs, tz: zone },
    route,
    vehicle: sanitizeVehicle(r.vehicle),
    preferences: sanitizePreferences(r.preferences),
    locale: r.locale === 'ru' ? 'ru' : 'en',
  };
}
