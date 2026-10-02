import { PACE_PRESETS, TRIP_THRESHOLDS } from '../config';
import { buildSchedule, type Schedule } from '../planning/schedule';
import type { RouteProfile } from '../route/profile';
import type { LongTripReason, TripCategory, TripClassification, TripPreferences, VehicleProfile } from '../types';

/**
 * TRIP CLASSIFICATION ENGINE — the one place that decides how "long" a trip is
 * (docs/features/LONG_TRIP_MODE.md §3). Distance sets the band; driving time
 * can raise it; Long Trip Mode switches on for LONG trips, overnight trips or
 * trips with several real breaks. Thresholds: `TRIP_THRESHOLDS`.
 */

const ORDER: TripCategory[] = ['SHORT', 'MEDIUM', 'EXTENDED', 'LONG'];

export function categoryOf(distanceKm: number, drivingMinutes: number, t = TRIP_THRESHOLDS): TripCategory {
  let c: TripCategory =
    distanceKm >= t.LONG_TRIP_DISTANCE_KM ? 'LONG' : distanceKm >= t.EXTENDED_TRIP_DISTANCE_KM ? 'EXTENDED' : distanceKm >= t.MEDIUM_TRIP_DISTANCE_KM ? 'MEDIUM' : 'SHORT';
  const raise = (to: TripCategory) => {
    if (ORDER.indexOf(to) > ORDER.indexOf(c)) c = to;
  };
  if (drivingMinutes >= t.LONG_TRIP_TIME_MINUTES) raise('LONG');
  else if (drivingMinutes >= t.EXTENDED_TRIP_TIME_MINUTES) raise('EXTENDED');
  return c;
}

export function atLeast(c: TripCategory, min: TripCategory): boolean {
  return ORDER.indexOf(c) >= ORDER.indexOf(min);
}

/** Classify from a schedule that was already built (the planner) … */
export function classifyFromSchedule(
  profile: RouteProfile,
  schedule: Schedule,
  opts: { timeZoneChanges?: number; borderCrossings?: number | null } = {},
  t = TRIP_THRESHOLDS,
): TripClassification {
  const distanceKm = profile.totalDistM / 1000;
  const drivingMinutes = Math.round((profile.totalTimeS - (profile.timeS[0] ?? 0)) / 60);
  const category = categoryOf(distanceKm, drivingMinutes, t);
  const requiresOvernight = schedule.stops.some((s) => s.kinds.includes('overnight'));
  const breaks = schedule.stops.filter((s) => !s.kinds.includes('overnight') && (s.kinds.includes('rest') || s.kinds.includes('meal'))).length;
  const reasons: LongTripReason[] = [];
  if (distanceKm >= t.LONG_TRIP_DISTANCE_KM) reasons.push('distance');
  if (drivingMinutes >= t.LONG_TRIP_TIME_MINUTES) reasons.push('driving-time');
  if (requiresOvernight) reasons.push('overnight');
  if (breaks >= t.LONG_TRIP_MIN_REST_STOPS) reasons.push('rest-stops');
  return {
    category,
    distanceKm: Math.round(distanceKm),
    drivingTimeMinutes: drivingMinutes,
    estimatedTotalTimeMinutes: Math.round((schedule.arriveMs - schedule.startMs) / 60000),
    requiresOvernight,
    requiresBorderCrossing: opts.borderCrossings === undefined || opts.borderCrossings === null ? null : opts.borderCrossings > 0,
    recommendedRestStops: breaks,
    timeZoneChanges: opts.timeZoneChanges ?? 0,
    longTripMode: reasons.length > 0,
    reasons,
  };
}

/** … or straight from a route (the client, instantly and offline). */
export function classifyTrip(input: {
  profile: RouteProfile;
  departAtMs: number;
  tzAt: (alongM: number) => string;
  preferences: TripPreferences;
  vehicle: VehicleProfile;
  timeZoneChanges?: number;
}): TripClassification {
  const schedule = buildSchedule({
    profile: input.profile,
    startAlongM: 0,
    startMs: input.departAtMs,
    tzAt: input.tzAt,
    pace: PACE_PRESETS[input.preferences.pace],
    vehicle: input.vehicle,
    rangeLeftKm: input.vehicle.rangeKm,
  });
  return classifyFromSchedule(input.profile, schedule, { timeZoneChanges: input.timeZoneChanges });
}

/** Time-zone changes along a list of per-sample zones (in route order). */
export function countTimeZoneChanges(zones: string[]): number {
  let n = 0;
  for (let i = 1; i < zones.length; i++) if (zones[i] && zones[i - 1] && zones[i] !== zones[i - 1]) n++;
  return n;
}
