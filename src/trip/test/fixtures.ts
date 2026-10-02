import type { LngLat } from '../../types/geo';
import { zonedWallTimeToUtc } from '../../utils/timezone';
import { encodePolyline } from '../../utils/polyline';
import { DEFAULT_TRIP_PREFERENCES } from '../config';
import { profileFromRequest, type RouteProfile } from '../route/profile';
import type { RawPlace, TripPlacesSource } from '../stops/places';
import type { TripPlaceRef, TripPlanRequest, TripWeatherSample } from '../types';

/** Test fixtures: a straight westward road along 41° N at a constant speed (Tbilisi → towards Istanbul). */

export const TZ = 'Asia/Tbilisi';
const KM_PER_DEG_LON = 111.32 * Math.cos((41 * Math.PI) / 180);

export function pointAtKm(km: number): LngLat {
  return [44.8 - km / KM_PER_DEG_LON, 41];
}

/** Local wall time in Tbilisi → UTC ms (2026-10-05 is a Monday). */
export function tbilisi(day: number, hour: number, minute = 0): number {
  return zonedWallTimeToUtc({ year: 2026, month: 10, day, hour, minute }, TZ);
}

export function routeRequest(distanceKm: number, kmh: number, extra: Partial<TripPlanRequest> = {}): TripPlanRequest {
  const stepM = 1000;
  const points: LngLat[] = [];
  const timesS: number[] = [];
  for (let km = 0; km < distanceKm; km += stepM / 1000) {
    points.push(pointAtKm(km));
    timesS.push(Math.round((km / kmh) * 3600));
  }
  points.push(pointAtKm(distanceKm));
  timesS.push(Math.round((distanceKm / kmh) * 3600));
  return {
    version: 1,
    route: {
      id: `test-${distanceKm}`,
      polyline: encodePolyline(points, 5),
      stepM,
      timesS,
      distanceM: distanceKm * 1000,
      origin: { name: 'Start', lat: 41, lon: 44.8 },
      destination: { name: 'End', lat: 41, lon: pointAtKm(distanceKm)[0] },
      tz: TZ,
    },
    departAtMs: tbilisi(5, 8),
    vehicle: { kind: 'car', powertrain: 'fuel' },
    preferences: { ...DEFAULT_TRIP_PREFERENCES },
    includePlaces: false,
    locale: 'en',
    ...extra,
  };
}

export function profileOf(req: TripPlanRequest): RouteProfile {
  return profileFromRequest(req.route)!;
}

export function town(name: string, km: number, kind: TripPlaceRef['kind'] = 'town', population?: number): TripPlaceRef {
  const [lon, lat] = pointAtKm(km);
  return { name, kind, alongM: km * 1000, lat, lon, ...(population ? { population } : {}) };
}

/** Hourly hazard samples every `everyKm`, all clear unless `hazard` says otherwise. */
export function weatherEvery(distanceKm: number, everyKm: number, t0: number, hazard: (km: number, hourMs: number) => number = () => 0, hours = 96): TripWeatherSample[] {
  const out: TripWeatherSample[] = [];
  for (let km = 0; km <= distanceKm; km += everyKm) {
    out.push({ alongM: km * 1000, tz: TZ, t0, h: Array.from({ length: hours }, (_, i) => hazard(km, t0 + i * 3_600_000)) });
  }
  return out;
}

/** A place near the road (offset north by `offKm`). */
export function rawPlace(id: string, category: RawPlace['category'], type: string, km: number, tags: Record<string, string>, offKm = 0.3): RawPlace {
  const [lon, lat] = pointAtKm(km);
  return { id, category, type, lat: lat + offKm / 111.32, lon, tags };
}

/** A places source answering from a fixed list (within the query's radii), counting calls. */
export function fakePlaces(all: RawPlace[], opts: { fail?: boolean } = {}): TripPlacesSource & { calls: number } {
  const src = {
    calls: 0,
    async find(q: { lat: number; lon: number; categories: { category: string; radiusKm: number }[] }) {
      src.calls++;
      if (opts.fail) throw new Error('overpass down');
      return all.filter((p) =>
        q.categories.some((c) => c.category === p.category && Math.hypot((p.lat - q.lat) * 111.32, (p.lon - q.lon) * KM_PER_DEG_LON) <= c.radiusKm),
      );
    },
  };
  return src;
}
