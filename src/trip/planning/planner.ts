import { mapWithConcurrency } from '../../services/http';
import { atLeast, classifyFromSchedule, countTimeZoneChanges } from '../classification/classify';
import { PACE_PRESETS, PLACE_RADIUS_KM, STOP_DEFAULTS } from '../config';
import { pointAtAlong, profileFromRequest, timeAtAlong, windowAround, type RouteProfile } from '../route/profile';
import { rankPlaces, type RankContext } from '../stops/recommend';
import type { PlaceQuery, RawPlace, TripPlacesSource } from '../stops/places';
import { decodePolyline } from '../../utils/polyline';
import type {
  AccommodationRecommendation,
  PlaceCategory,
  StopKind,
  StopPlaces,
  StopPlacesRequest,
  TimelineEntry,
  TripAdvice,
  TripDay,
  TripPlan,
  TripPlanRequest,
  TripSegment,
  TripStop,
} from '../types';
import { nearestPlace, stopEarlierAdvice, weatherRisks } from '../weather/risks';
import { overnightCandidates } from './overnight';
import { buildSchedule, wallAtAlong, type Schedule, type ScheduledStop } from './schedule';

/**
 * TRIP PLANNER — route + vehicle + departure + preferences (+ the client's
 * forecasts and settlements) → TripPlan. Deterministic apart from the places
 * lookup, which is best effort: when it fails or runs out of budget the plan
 * is still complete, its stops just say "places unavailable".
 * Runs in the Worker (ADR-013); has no DOM or Workers-only dependencies.
 */

export interface PlannerDeps {
  places?: TripPlacesSource | null;
  nowMs: number;
  signal?: AbortSignal;
  /** Most place lookups for one plan (each is one Overpass query). */
  maxPlaceQueries?: number;
}

export class TripPlanError extends Error {}

function categoriesFor(kinds: StopKind[], hotelKm: number): { category: PlaceCategory; radiusKm: number }[] {
  const out: { category: PlaceCategory; radiusKm: number }[] = [];
  if (kinds.includes('overnight')) out.push({ category: 'hotel', radiusKm: hotelKm }, { category: 'food', radiusKm: PLACE_RADIUS_KM.food });
  if (kinds.includes('meal') && !kinds.includes('overnight')) out.push({ category: 'food', radiusKm: PLACE_RADIUS_KM.food });
  if (kinds.includes('fuel')) out.push({ category: 'fuel', radiusKm: PLACE_RADIUS_KM.fuel });
  if (kinds.includes('charge')) out.push({ category: 'charging', radiusKm: PLACE_RADIUS_KM.charging });
  if (kinds.includes('rest') && !kinds.includes('overnight')) out.push({ category: 'rest', radiusKm: PLACE_RADIUS_KM.rest });
  return out;
}

export async function createTripPlan(req: TripPlanRequest, deps: PlannerDeps): Promise<TripPlan> {
  const profile = profileFromRequest(req.route);
  if (!profile) throw new TripPlanError('invalid route');
  const prefs = req.preferences;
  const pace = PACE_PRESETS[prefs.pace];
  const samples = [...(req.weather ?? [])].sort((a, b) => a.alongM - b.alongM);
  const fallbackTz = req.route.tz ?? samples[0]?.tz ?? 'UTC';
  const tzAt = (alongM: number) => {
    let best = samples[0];
    for (const s of samples) if (Math.abs(s.alongM - alongM) < Math.abs(best.alongM - alongM)) best = s;
    return best?.tz ?? fallbackTz;
  };

  const progress = req.progress;
  const base = {
    profile,
    startAlongM: progress ? Math.min(progress.alongM, profile.totalDistM) : 0,
    startMs: progress ? progress.nowMs : req.departAtMs,
    tzAt,
    pace,
    vehicle: req.vehicle,
    drivenTodayS: progress?.drivenTodayS ?? 0,
    sinceRestS: progress?.sinceRestS ?? 0,
    // Replanning: the range left at the car, never the range the trip started with (B-01); unknown stays unknown.
    rangeLeftKm: progress ? progress.rangeKm : req.vehicle.rangeKm,
  };

  // ---- Places: one lookup per stop area, cached for this plan, within a budget ----
  const usePlaces = req.includePlaces !== false && !!deps.places;
  let budget = deps.maxPlaceQueries ?? 14;
  let failed = 0;
  let asked = 0;
  const found = new Map<number, RawPlace[] | null>();
  const lookup = async (alongM: number, kinds: StopKind[]): Promise<RawPlace[] | null | 'skipped'> => {
    const key = Math.round(alongM / 500);
    if (found.has(key)) return found.get(key)!;
    if (!usePlaces || budget <= 0 || deps.signal?.aborted) return 'skipped';
    budget--;
    asked++;
    const [lon, lat] = pointAtAlong(profile, alongM);
    const q: PlaceQuery = { lat, lon, categories: categoriesFor(kinds, prefs.hotelMaxDetourKm), vehicle: req.vehicle };
    try {
      const raw = await deps.places!.find(q, deps.signal);
      found.set(key, raw);
      return raw;
    } catch {
      failed++;
      found.set(key, null);
      return null;
    }
  };
  const rankCtx = (s: ScheduledStop): RankContext => ({
    routePoints: routeWindow(profile, s.alongM),
    arriveMs: s.arriveMs,
    tz: tzAt(s.alongM),
    preferences: prefs,
    vehicle: req.vehicle,
    locale: req.locale,
  });

  // ---- Overnight areas, one night at a time (each choice moves the following days) ----
  // Nights the user picked themselves ("Stay in X instead") are kept as they are.
  const forced: number[] = [...(req.overnightsM ?? [])].filter((m) => m > base.startAlongM && m < profile.totalDistM).sort((a, b) => a - b);
  const alternatives = new Map<number, ReturnType<typeof overnightCandidates>>();
  let schedule = buildSchedule({ ...base, forcedOvernightsM: forced });
  for (let night = 0; night < STOP_DEFAULTS.maxOvernights; night++) {
    const free = schedule.stops.find((s) => s.kinds.includes('overnight') && !forced.some((f) => Math.abs(f - s.alongM) < 1));
    if (!free) break;
    const after = forced.at(-1) ?? base.startAlongM;
    const candidates = overnightCandidates(profile, free, req.places, after);
    // A town an hour earlier is worth it only if it doesn't add a whole extra night to the trip.
    const nights = (sched: Schedule) => sched.stops.filter((s) => s.kinds.includes('overnight')).length;
    const baseline = nights(schedule);
    for (const c of candidates) {
      const extra = nights(buildSchedule({ ...base, forcedOvernightsM: [...forced, c.alongM].sort((a, b) => a - b) })) - baseline;
      if (extra > 0) c.score -= 4 * extra;
    }
    candidates.sort((a, b) => b.score - a.score);
    let choice = candidates[0];
    if (usePlaces && candidates.length > 0) {
      const results = await mapWithConcurrency(candidates, 2, (c) => lookup(c.alongM, ['overnight', ...free.kinds.filter((k) => k !== 'overnight')]));
      let bestScore = -Infinity;
      candidates.forEach((c, i) => {
        const raw = results[i];
        const hotels = Array.isArray(raw) ? rankPlaces('hotel', raw, { ...rankCtx(free), routePoints: routeWindow(profile, c.alongM) }, prefs.hotelMaxDetourKm).length : 0;
        const score = c.score + Math.min(hotels, 5) * 0.4 - (Array.isArray(raw) && hotels === 0 ? 3 : 0);
        if (score > bestScore) {
          bestScore = score;
          choice = c;
        }
      });
    }
    forced.push(choice.alongM);
    forced.sort((a, b) => a - b);
    alternatives.set(choice.alongM, candidates.filter((c) => c !== choice && c.name));
    schedule = buildSchedule({ ...base, forcedOvernightsM: forced });
  }

  // ---- Places for every stop ----
  const stopPlaces = await mapWithConcurrency(schedule.stops, 2, async (s) => {
    const cats = categoriesFor(s.kinds, prefs.hotelMaxDetourKm);
    const raw = await lookup(s.alongM, s.kinds);
    return cats.map(({ category, radiusKm }): StopPlaces => {
      if (raw === 'skipped') return { category, status: 'skipped', places: [] };
      if (raw === null) return { category, status: 'unavailable', places: [] };
      const places = rankPlaces(category, raw, rankCtx(s), radiusKm);
      return { category, status: places.length ? 'ok' : 'none-found', places };
    });
  });

  // ---- Assemble ----
  const stops: TripStop[] = schedule.stops.map((s, i) => {
    const [lon, lat] = pointAtAlong(profile, s.alongM);
    return {
      id: `s${i + 1}`,
      kinds: s.kinds,
      alongM: Math.round(s.alongM),
      lat,
      lon,
      placeName: nearestPlace(req.places, s.alongM, 8000)?.name,
      driveTimeS: Math.round(s.driveTimeS),
      arriveMs: s.arriveMs,
      departMs: s.departMs,
      dwellMinutes: Math.round(s.dwellS / 60),
      tz: tzAt(s.alongM),
      day: s.day,
      why: s.why,
      places: stopPlaces[i],
    };
  });

  const risks = samples.length ? weatherRisks(profile, schedule, samples, req.places) : [];
  const advice: TripAdvice[] = samples.length
    ? stopEarlierAdvice({ profile, schedule, risks, samples, places: req.places, pace, tzAt })
    : [];
  const classification = classifyFromSchedule(profile, schedule, { timeZoneChanges: countTimeZoneChanges(samples.map((s) => s.tz)) });
  if (req.vehicle.rangeKm === undefined && progress?.rangeKm === undefined && atLeast(classification.category, 'EXTENDED')) advice.push({ kind: 'enter-range' });
  // A range without the tank size: after a fill the range is unknown, so later fills can't be planned (B-20). A full
  // tank reaches at least as far as the range entered, so say so only when the road after the fill is longer.
  if (req.vehicle.rangeKm !== undefined && req.vehicle.fullRangeKm === undefined) {
    const lastFill = schedule.stops.filter((s) => s.kinds.includes('fuel') || s.kinds.includes('charge')).at(-1);
    const fromM = lastFill ? lastFill.alongM : progress && progress.rangeKm === undefined ? base.startAlongM : null;
    if (fromM !== null && profile.totalDistM - fromM > req.vehicle.rangeKm * 1000 * 0.9) advice.push({ kind: 'enter-tank' });
  }
  for (const s of stops) {
    for (const p of s.places) {
      if (p.status === 'none-found' && (p.category === 'hotel' || p.category === 'fuel' || p.category === 'charging')) {
        advice.push({ kind: 'no-places', category: p.category, stopId: s.id });
      }
    }
  }

  const segments = buildSegments(profile, schedule);
  const days = buildDays(segments, stops, req.route.origin.name, req.route.destination.name, schedule);
  const accommodation: AccommodationRecommendation[] = stops
    .filter((s) => s.kinds.includes('overnight'))
    .map((s) => {
      const hotels = s.places.find((p) => p.category === 'hotel');
      const others = [...alternatives.entries()].find(([m]) => Math.abs(m - s.alongM) < 1)?.[1] ?? [];
      return {
        stopId: s.id,
        areaName: s.placeName,
        arriveMs: s.arriveMs,
        departMs: s.departMs,
        nights: 1,
        tz: s.tz,
        hotels: hotels?.places ?? [],
        availability: 'not-checked',
        status: hotels?.status ?? 'skipped',
        alternatives: others.map((c) => ({ alongM: Math.round(c.alongM), name: c.name!, kind: c.kind, arriveMs: wallAtAlong(schedule, profile, c.alongM) })),
      };
    });

  const timeline = buildTimeline(stops, risks, req, schedule, tzAt);
  const placesStatus: TripPlan['dataStatus']['places'] = !usePlaces
    ? 'skipped'
    : asked === 0 && schedule.stops.length > 0
      ? 'skipped'
      : failed > 0 && failed >= asked
        ? 'unavailable'
        : failed > 0 || stops.some((s) => s.places.some((p) => p.status === 'skipped'))
          ? 'partial'
          : 'ok';

  return {
    version: 1,
    routeId: req.route.id,
    createdAtMs: deps.nowMs,
    classification,
    origin: req.route.origin,
    destination: req.route.destination,
    departAtMs: req.departAtMs,
    arriveAtMs: schedule.arriveMs,
    totalDistanceKm: Math.round(profile.totalDistM / 1000),
    estimatedDrivingTimeMinutes: Math.round(profile.totalTimeS / 60),
    estimatedTotalTimeMinutes: Math.round((schedule.arriveMs - (progress ? req.departAtMs : schedule.startMs)) / 60000),
    segments,
    days,
    recommendedStops: stops,
    accommodation,
    weatherRisks: risks,
    advice,
    timeline,
    summary: {
      overnights: stops.filter((s) => s.kinds.includes('overnight')).length,
      fuelStops: stops.filter((s) => s.kinds.includes('fuel') || s.kinds.includes('charge')).length,
      restStops: stops.filter((s) => s.kinds.includes('rest') && !s.kinds.includes('overnight')).length,
      mealStops: stops.filter((s) => s.kinds.includes('meal')).length,
      weatherRisks: risks.length,
      borderCrossings: null,
    },
    dataStatus: { places: placesStatus, weather: samples.length ? 'ok' : 'missing' },
    ...(progress ? { progress } : {}),
  };
}

function buildSegments(profile: RouteProfile, schedule: Schedule): TripSegment[] {
  const out: TripSegment[] = [];
  let fromM = schedule.startAlongM;
  let departMs = schedule.startMs;
  let day = 0;
  for (const s of schedule.stops) {
    out.push({
      day,
      fromM: Math.round(fromM),
      toM: Math.round(s.alongM),
      departMs,
      arriveMs: s.arriveMs,
      distanceKm: Math.round((s.alongM - fromM) / 100) / 10,
      drivingMinutes: Math.round((timeAtAlong(profile, s.alongM) - timeAtAlong(profile, fromM)) / 60),
    });
    fromM = s.alongM;
    departMs = s.departMs;
    if (s.kinds.includes('overnight')) day++;
  }
  out.push({
    day,
    fromM: Math.round(fromM),
    toM: Math.round(profile.totalDistM),
    departMs,
    arriveMs: schedule.arriveMs,
    distanceKm: Math.round((profile.totalDistM - fromM) / 100) / 10,
    drivingMinutes: Math.round((profile.totalTimeS - timeAtAlong(profile, fromM)) / 60),
  });
  return out;
}

function buildDays(segments: TripSegment[], stops: TripStop[], originName: string, destinationName: string, schedule: Schedule): TripDay[] {
  const days: TripDay[] = [];
  for (let d = 0; d < schedule.days; d++) {
    const segs = segments.filter((s) => s.day === d);
    if (!segs.length) continue;
    const night = stops.find((s) => s.day === d && s.kinds.includes('overnight'));
    const prevNight = stops.find((s) => s.day === d - 1 && s.kinds.includes('overnight'));
    days.push({
      index: d,
      fromName: d === 0 ? originName : (prevNight?.placeName ?? ''),
      toName: night ? (night.placeName ?? '') : destinationName,
      startMs: segs[0].departMs,
      endMs: segs[segs.length - 1].arriveMs,
      distanceKm: Math.round(segs.reduce((a, s) => a + s.distanceKm, 0)),
      drivingMinutes: segs.reduce((a, s) => a + s.drivingMinutes, 0),
      stopIds: stops.filter((s) => s.day === d).map((s) => s.id),
    });
  }
  return days;
}

function primaryKind(kinds: StopKind[]): TimelineEntry['kind'] {
  if (kinds.includes('overnight')) return 'overnight';
  if (kinds.includes('meal')) return 'meal';
  if (kinds.includes('charge')) return 'charge';
  if (kinds.includes('fuel')) return 'fuel';
  return 'rest';
}

function buildTimeline(
  stops: TripStop[],
  risks: TripPlan['weatherRisks'],
  req: TripPlanRequest,
  schedule: Schedule,
  tzAt: (m: number) => string,
): TimelineEntry[] {
  const out: TimelineEntry[] = [
    { atMs: schedule.startMs, tz: tzAt(schedule.startAlongM), kind: req.progress ? 'continue' : 'depart', day: 0, alongM: Math.round(schedule.startAlongM), placeName: req.progress ? undefined : req.route.origin.name },
  ];
  for (const s of stops) {
    out.push({ atMs: s.arriveMs, tz: s.tz, kind: primaryKind(s.kinds), day: s.day, alongM: s.alongM, stopId: s.id, placeName: s.placeName, dwellMinutes: s.dwellMinutes });
    if (s.kinds.includes('overnight')) out.push({ atMs: s.departMs, tz: s.tz, kind: 'continue', day: s.day + 1, alongM: s.alongM, stopId: s.id, placeName: s.placeName });
  }
  for (const r of risks) {
    if (r.severity !== 'high' && r.kind === 'rain') continue; // ordinary rain stays in the weather list, not the timeline
    const day = [...stops].reverse().find((s) => s.kinds.includes('overnight') && s.alongM <= r.fromM)?.day;
    out.push({ atMs: r.startMs, tz: r.tz, kind: 'weather', day: day === undefined ? 0 : day + 1, alongM: r.fromM, hazard: r.kind, placeName: r.placeName });
  }
  const lastDay = stops.filter((s) => s.kinds.includes('overnight')).length;
  out.push({ atMs: schedule.arriveMs, tz: tzAt(req.route.distanceM), kind: 'arrive', day: lastDay, alongM: req.route.distanceM, placeName: req.route.destination.name });
  return out.sort((a, b) => a.atMs - b.atMs);
}

/** The road around a stop (±30 km), for "distance from the route". */
export function routeWindow(profile: RouteProfile, alongM: number) {
  const [a, b] = windowAround(profile, alongM, 30_000);
  return profile.points.slice(a, b + 1);
}

/**
 * Places around one stop (POST /api/v1/trips/places): loaded when the user
 * opens a stop, so a plan never waits for Overpass. Failure → 'unavailable'.
 */
export async function findStopPlaces(req: StopPlacesRequest, source: TripPlacesSource, signal?: AbortSignal): Promise<StopPlaces[]> {
  const cats = categoriesFor(req.stop.kinds, req.preferences.hotelMaxDetourKm);
  const routePoints = decodePolyline(req.route, 5);
  let raw: RawPlace[] | null = null;
  try {
    raw = await source.find({ lat: req.stop.lat, lon: req.stop.lon, categories: cats, vehicle: req.vehicle }, signal);
  } catch {
    raw = null;
  }
  const ctx: RankContext = {
    routePoints: routePoints.length ? routePoints : [[req.stop.lon, req.stop.lat]],
    arriveMs: req.stop.arriveMs,
    tz: req.stop.tz,
    preferences: req.preferences,
    vehicle: req.vehicle,
    locale: req.locale,
  };
  return cats.map(({ category, radiusKm }) => {
    if (!raw) return { category, status: 'unavailable', places: [] };
    const places = rankPlaces(category, raw, ctx, radiusKm);
    return { category, status: places.length ? 'ok' : 'none-found', places };
  });
}
