import { zonedParts, zonedWallTimeToUtc } from '../../utils/timezone';
import type { PacePreset } from '../config';
import { wallAtAlong, type Schedule, type ScheduledStop } from '../planning/schedule';
import { timeAtAlong, type RouteProfile } from '../route/profile';
import type { TripAdvice, TripPlaceRef, TripWeatherSample, WeatherRisk } from '../types';
import { codeAt, HAZARD_CODES, severityOf } from './hazards';

/**
 * Weather along the trip AT THE PLANNED TIMES (stops included): stretches of
 * the same hazard, and — when severe weather falls on the last hours before
 * an overnight stay — a suggestion to stop earlier and drive that stretch the
 * next morning instead, if the forecast is better then. Always a suggestion
 * with its reason; the plan itself is never changed silently.
 */

export function nearestPlace(places: TripPlaceRef[] | undefined, alongM: number, withinM = 15_000): TripPlaceRef | undefined {
  let best: TripPlaceRef | undefined;
  for (const p of places ?? []) {
    const d = Math.abs(p.alongM - alongM);
    if (d <= withinM && (!best || d < Math.abs(best.alongM - alongM))) best = p;
  }
  return best;
}

export function weatherRisks(
  profile: RouteProfile,
  schedule: Schedule,
  samples: TripWeatherSample[],
  places: TripPlaceRef[] | undefined,
): WeatherRisk[] {
  const sorted = samples.filter((s) => s.alongM >= schedule.startAlongM).sort((a, b) => a.alongM - b.alongM);
  const risks: WeatherRisk[] = [];
  let open: WeatherRisk | null = null;
  for (const s of sorted) {
    const at = wallAtAlong(schedule, profile, s.alongM);
    const kind = HAZARD_CODES[Math.max(0, codeAt(s, at))] ?? null;
    const sev = severityOf(kind);
    if (open && kind === open.kind) {
      open.toM = s.alongM;
      open.endMs = at;
      continue;
    }
    if (open) risks.push(open);
    open = sev > 0 && kind
      ? { kind, severity: sev === 2 ? 'high' : 'medium', fromM: s.alongM, toM: s.alongM, startMs: at, endMs: at, placeName: nearestPlace(places, s.alongM)?.name, tz: s.tz }
      : null;
  }
  if (open) risks.push(open);
  return risks;
}

/**
 * The earliest planned time (stops included) at which a sample has no forecast — the trip's weather is only known
 * until then (B-21). Null when the forecasts cover every sample at its planned time.
 */
export function forecastEndsAt(profile: RouteProfile, schedule: Schedule, samples: TripWeatherSample[]): number | null {
  let end: number | null = null;
  for (const s of samples) {
    if (s.alongM < schedule.startAlongM) continue;
    const at = wallAtAlong(schedule, profile, s.alongM);
    if (codeAt(s, at) < 0 && (end === null || at < end)) end = at;
  }
  return end;
}

/** Highest hazard severity on [fromM, toM] if that stretch is driven starting at `startMs` from `startAlongM`. */
function severityIfDriven(profile: RouteProfile, samples: TripWeatherSample[], startAlongM: number, startMs: number, fromM: number, toM: number): number {
  const T0 = timeAtAlong(profile, startAlongM);
  let worst = 0;
  for (const s of samples) {
    if (s.alongM < fromM - 1 || s.alongM > toM + 1) continue;
    const at = startMs + (timeAtAlong(profile, s.alongM) - T0) * 1000;
    const code = codeAt(s, at);
    if (code < 0) return 2; // no forecast for the morning: can't promise it's better
    worst = Math.max(worst, severityOf(HAZARD_CODES[code] ?? null));
  }
  return worst;
}

function nextMorning(arriveMs: number, tz: string, pace: PacePreset): number {
  const p = zonedParts(arriveMs, tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + (p.hour >= 12 ? 1 : 0)));
  const morning = zonedWallTimeToUtc({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: pace.morningStartHour, minute: 0 }, tz);
  return Math.max(arriveMs + pace.minOvernightS * 1000, morning);
}

export function stopEarlierAdvice(input: {
  profile: RouteProfile;
  schedule: Schedule;
  risks: WeatherRisk[];
  samples: TripWeatherSample[];
  places: TripPlaceRef[] | undefined;
  pace: PacePreset;
  tzAt: (alongM: number) => string;
}): TripAdvice[] {
  const { profile, schedule, risks, samples, places, pace } = input;
  const advice: TripAdvice[] = [];
  const overnights = schedule.stops.filter((s) => s.kinds.includes('overnight'));
  for (const night of overnights) {
    const prevEnd = previousOvernight(schedule.stops, night)?.alongM ?? schedule.startAlongM;
    const risk = risks.find(
      (r) => r.severity === 'high' && r.toM <= night.alongM + 1 && r.fromM > prevEnd && r.startMs >= night.arriveMs - 3 * 3600_000,
    );
    if (!risk) continue;
    const Trisk = timeAtAlong(profile, risk.fromM);
    // Earlier places to stop: before the stretch, at most 2.5 h of driving earlier, after the previous night.
    const candidates = (places ?? [])
      .filter((p) => p.alongM < risk.fromM - 2000 && p.alongM > prevEnd && timeAtAlong(profile, p.alongM) >= Trisk - 2.5 * 3600)
      .sort((a, b) => kindWeight(b) - kindWeight(a) || b.alongM - a.alongM);
    const options = candidates.length ? candidates : [];
    for (const c of options.slice(0, 4)) {
      const arrive = wallAtAlong(schedule, profile, c.alongM);
      const tz = input.tzAt(c.alongM);
      const morning = nextMorning(arrive, tz, pace);
      if (severityIfDriven(profile, samples, c.alongM, morning, risk.fromM, risk.toM) < 2) {
        advice.push({ kind: 'stop-earlier', risk, alongM: c.alongM, areaName: c.name, arriveMs: arrive, tz });
        break;
      }
    }
  }
  return advice;
}

function kindWeight(p: TripPlaceRef): number {
  return p.kind === 'city' ? 3 : p.kind === 'town' ? 2 : 1;
}

function previousOvernight(stops: ScheduledStop[], night: ScheduledStop): ScheduledStop | undefined {
  let prev: ScheduledStop | undefined;
  for (const s of stops) {
    if (s === night) break;
    if (s.kinds.includes('overnight')) prev = s;
  }
  return prev;
}
