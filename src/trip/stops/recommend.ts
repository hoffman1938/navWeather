import type { LngLat } from '../../types/geo';
import { projectOntoSegment } from '../../utils/distance';
import { zonedParts } from '../../utils/timezone';
import type { PlaceCategory, ReasonCode, RecommendedPlace, TripPreferences, VehicleProfile } from '../types';
import { openStatus } from './openingHours';
import type { RawPlace } from './places';

/**
 * SMART RECOMMENDATIONS — a few places per stop, each with the reasons it was
 * picked (docs/features/LONG_TRIP_MODE.md §8). Only what OpenStreetMap says:
 * no ratings, prices or availability exist in the data, so none are shown.
 * "Closed when you get there" (from opening_hours) is filtered out; unknown
 * hours are kept and labelled.
 */

export interface RankContext {
  /** The road near the stop (a few dozen km either side), to measure how far places are from it. */
  routePoints: LngLat[];
  arriveMs: number;
  tz: string;
  preferences: TripPreferences;
  vehicle: VehicleProfile;
  locale?: string;
}

export const LIMITS: Record<PlaceCategory, number> = { hotel: 5, fuel: 3, charging: 3, food: 3, rest: 2 };

/** Straight-line distance (km) from a place to the nearby route (not a driving detour). */
export function distanceFromRouteKm(routePoints: LngLat[], p: LngLat): number {
  let best = Infinity;
  for (let i = 0; i < routePoints.length - 1; i++) best = Math.min(best, projectOntoSegment(p, routePoints[i], routePoints[i + 1]).distanceM);
  return routePoints.length === 1 ? haversineKm(routePoints[0], p) : best / 1000;
}

function haversineKm(a: LngLat, b: LngLat): number {
  const R = 6371.0088;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function localClock(ms: number, tz: string): { weekday: number; minutes: number; label: string } {
  const p = zonedParts(ms, tz);
  const weekday = (new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 6) % 7;
  return { weekday, minutes: p.hour * 60 + p.minute, label: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` };
}

function nameOf(tags: Record<string, string>, locale?: string): string {
  return (locale && tags[`name:${locale}`]) || tags.name || tags.brand || tags.operator || '';
}

function stars(tags: Record<string, string>): number | undefined {
  const n = parseFloat(tags.stars ?? '');
  return Number.isFinite(n) && n >= 1 && n <= 7 ? Math.floor(n) : undefined;
}

function maxKw(tags: Record<string, string>): number | undefined {
  let best: number | undefined;
  for (const [k, v] of Object.entries(tags)) {
    if (!/^(socket:[a-z0-9_]+:output|charging_station:output)$/.test(k)) continue;
    const m = /([\d.]+)\s*(kw|kW|KW)?/.exec(v);
    const kw = m ? parseFloat(m[1]) : NaN;
    if (Number.isFinite(kw) && kw > 0 && kw < 1000) best = Math.max(best ?? 0, kw);
  }
  return best;
}

export function rankPlaces(category: PlaceCategory, raw: RawPlace[], ctx: RankContext, radiusKm: number): RecommendedPlace[] {
  const clock = localClock(ctx.arriveMs, ctx.tz);
  const night = clock.minutes >= 22 * 60 || clock.minutes < 6 * 60;
  const scored: { place: RecommendedPlace; score: number }[] = [];
  for (const r of raw) {
    if (r.category !== category) continue;
    const km = distanceFromRouteKm(ctx.routePoints, [r.lon, r.lat]);
    if (km > radiusKm) continue;
    const reasons: ReasonCode[] = [{ code: 'near-route', km: Math.round(km * 10) / 10 }];
    const name = nameOf(r.tags, ctx.locale);
    let score = -km * 0.6;
    const status = r.tags.opening_hours?.trim() === '24/7' ? 'open' : openStatus(r.tags.opening_hours, clock.weekday, clock.minutes);
    const place: Omit<RecommendedPlace, 'reasons'> = {
      id: r.id,
      category,
      name,
      type: r.type,
      lat: r.lat,
      lon: r.lon,
      distanceFromRouteKm: Math.round(km * 10) / 10,
    };

    if (category === 'hotel') {
      if (!name) continue; // an unnamed building is not a recommendation
      const s = stars(r.tags);
      if (s !== undefined) {
        if (s < ctx.preferences.hotelMinStars) continue;
        place.stars = s;
        reasons.push({ code: 'stars', n: s });
        score += s * 0.5;
      } else if (ctx.preferences.hotelMinStars > 0) {
        score -= 1.5; // star class not listed: keep, but behind ones that meet the wish
      }
      if (r.tags.parking || r.tags['parking:fee'] || r.tags.amenity === 'parking') {
        reasons.push({ code: 'parking' });
        score += 0.5;
      }
      score += r.type === 'hotel' || r.type === 'motel' ? 0.5 : r.type === 'guest_house' ? 0.2 : 0;
    } else {
      if (status === 'closed') continue;
      if (status === 'open') {
        reasons.push(r.tags.opening_hours?.trim() === '24/7' ? { code: 'open-24-7' } : { code: 'open-at', time: clock.label });
        score += 1.5;
      } else {
        reasons.push({ code: 'hours-unknown' });
        if (night) score -= 1; // at night an unknown-hours place is a gamble
      }
      place.openStatus = status;
    }

    if (category === 'fuel' || category === 'charging') {
      const brand = r.tags.brand || r.tags.operator;
      if (brand) place.brand = brand;
      if (ctx.preferences.fuelBrand && brand && brand.toLowerCase().includes(ctx.preferences.fuelBrand.toLowerCase())) {
        reasons.push({ code: 'brand', brand });
        score += 2;
      }
      if (category === 'fuel' && ctx.vehicle.kind === 'truck' && (r.tags.hgv === 'yes' || r.tags['fuel:HGV_diesel'] === 'yes')) {
        reasons.push({ code: 'truck-parking' });
        score += 1.5;
      }
      if (category === 'charging') {
        const kw = maxKw(r.tags);
        if (kw !== undefined) {
          place.maxKw = kw;
          if (kw >= 50) {
            reasons.push({ code: 'fast-charger', kw });
            score += 2;
          }
        }
      }
      if (!name && !brand) score -= 0.5;
    }

    if (category === 'food') {
      const pref = ctx.preferences.food;
      if (pref !== 'any' && r.type !== pref) continue;
      if (!name) continue;
    }

    if (category === 'rest') {
      if (r.type === 'services') {
        reasons.push({ code: 'motorway-services' });
        score += 1;
      }
      if (r.type === 'truck_parking') {
        reasons.push({ code: 'truck-parking' });
        score += ctx.vehicle.kind === 'truck' ? 2 : -5;
      }
      if (r.tags.toilets === 'yes') {
        reasons.push({ code: 'toilets' });
        score += 0.5;
      }
    }

    scored.push({ place: { ...place, reasons }, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.place.distanceFromRouteKm - b.place.distanceFromRouteKm)
    .slice(0, LIMITS[category])
    .map((s) => s.place);
}
