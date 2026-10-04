import { zonedParts, zonedWallTimeToUtc } from '../../utils/timezone';
import { STOP_DEFAULTS, type PacePreset } from '../config';
import { alongAtTime, timeAtAlong, type RouteProfile } from '../route/profile';
import type { StopKind, TripStop, VehicleProfile } from '../types';

/**
 * THE TRIP SCHEDULE — when and where to break, eat, refuel/charge and sleep.
 *
 * A deterministic walk along the route in driving time. At each step the
 * candidates are: the next break (pace interval), the next meal (local meal
 * windows, after the first hour of the day), the next fuel/charge (only with
 * a range the user entered — never estimated), and the overnight stay (daily
 * driving or the latest arrival hour, unless the destination is close). The
 * earliest wins; candidates due within the merge window join it, so one stop
 * can be "fuel + break" or "dinner + overnight". Wall-clock times are read in
 * each stop's own time zone.
 */

export interface ScheduledStop {
  kinds: StopKind[];
  alongM: number;
  /** Driving time from the route start (s). */
  driveTimeS: number;
  arriveMs: number;
  departMs: number;
  dwellS: number;
  day: number;
  why: TripStop['why'];
}

export interface Schedule {
  stops: ScheduledStop[];
  startAlongM: number;
  startMs: number;
  arriveMs: number;
  /** Travel days (1 = no overnight). */
  days: number;
}

export interface ScheduleInput {
  profile: RouteProfile;
  /** Where and when driving starts (route start, or the car while replanning). */
  startAlongM: number;
  startMs: number;
  tzAt: (alongM: number) => string;
  pace: PacePreset;
  vehicle: VehicleProfile;
  drivenTodayS?: number;
  sinceRestS?: number;
  /** Remaining range now (km); unknown → no fuel stops are planned. */
  rangeLeftKm?: number;
  /** Overnight stays fixed by the planner (along-route positions, ascending). */
  forcedOvernightsM?: number[];
}

function localHour(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  return p.hour + p.minute / 60;
}

/** UTC ms of a local wall time `hour` on the local date of `ms`, shifted by `dayOffset` days. */
function atLocalHour(ms: number, tz: string, hour: number, dayOffset = 0): number {
  const p = zonedParts(ms, tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset));
  const h = Math.floor(hour);
  return zonedWallTimeToUtc({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: h, minute: Math.round((hour - h) * 60) }, tz);
}

function dateKey(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

interface Candidate {
  kind: StopKind;
  inS: number;
  why: TripStop['why'][number];
  mealKey?: string;
}

export function buildSchedule(input: ScheduleInput): Schedule {
  const { profile, pace, vehicle } = input;
  const ev = vehicle.powertrain === 'ev';
  const fullRangeM = vehicle.fullRangeKm ? vehicle.fullRangeKm * 1000 : undefined;
  // Range bookkeeping from the last fill: where it was, and how far that range reaches.
  let fillAlongM = input.startAlongM;
  let fillRangeM = input.rangeLeftKm !== undefined ? input.rangeLeftKm * 1000 : undefined;
  const forced = (input.forcedOvernightsM ?? []).filter((f) => f > input.startAlongM).sort((a, b) => a - b);

  let along = input.startAlongM;
  let T = timeAtAlong(profile, along);
  let wall = input.startMs;
  let drivenToday = input.drivenTodayS ?? 0;
  let sinceRest = input.sinceRestS ?? 0;
  /** When this driving day began (for the latest-arrival rule). */
  let dayStart = input.startMs - drivenToday * 1000;
  let day = 0;
  const eaten = new Set<string>();
  const stops: ScheduledStop[] = [];

  for (let guard = 0; guard < 400; guard++) {
    const remaining = profile.totalTimeS - T;
    if (remaining <= 1) break;
    const tz = input.tzAt(along);
    const candidates: Candidate[] = [];

    // Break: every `restEveryS` of driving.
    candidates.push({ kind: 'rest', inS: Math.max(0, pace.restEveryS - sinceRest), why: 'interval' });

    // Fuel / charge: only from a range the user gave us. Due when `rangeUse` of the range since the
    // last fill is used; not needed when the destination is within the range with a 10 % reserve.
    if (fillRangeM !== undefined && profile.totalDistM > fillAlongM + fillRangeM * 0.9) {
      const at = fillAlongM + fillRangeM * STOP_DEFAULTS.rangeUse;
      candidates.push({ kind: ev ? 'charge' : 'fuel', inS: Math.max(0, timeAtAlong(profile, at) - T), why: 'range' });
    }

    // Meal: the next local meal window not yet used, after the first hour of the day's driving.
    const meal = nextMeal(wall, tz, eaten, drivenToday);
    if (meal) candidates.push({ kind: 'meal', inS: meal.inS, why: 'meal-window', mealKey: meal.key });

    // Overnight: daily driving, or the latest arrival hour — unless the destination is close.
    const overnight = overnightIn(wall, tz, pace, drivenToday, dayStart);
    let overnightCandidate: Candidate | null = { kind: 'overnight', inS: overnight.inS, why: overnight.why };
    const nextForced = forced.find((f) => f > along + 1);
    if (nextForced !== undefined) {
      const forcedIn = timeAtAlong(profile, nextForced) - T;
      if (forcedIn <= pace.dailyDriveS - drivenToday + STOP_DEFAULTS.finishToleranceS) overnightCandidate = { kind: 'overnight', inS: Math.max(0, forcedIn), why: 'daily-limit' };
    }
    if (overnightCandidate && remaining <= overnightCandidate.inS + STOP_DEFAULTS.finishToleranceS && nextForced === undefined) {
      overnightCandidate = null; // finish the trip today
    }
    if (overnightCandidate) candidates.push(overnightCandidate);

    // Breaks and meals just before arriving are pointless.
    const useful = candidates.filter((c) => c.kind === 'overnight' || c.kind === 'fuel' || c.kind === 'charge' || remaining - c.inS > 30 * 60);
    const earliest = useful.reduce<Candidate | null>((a, c) => (!a || c.inS < a.inS ? c : a), null);
    if (!earliest || earliest.inS >= remaining) break;
    // An overnight due soon after another stop is where that stop happens: a break 20 min before
    // the night's stop is pointless, and a night must stay exactly where the planner put it.
    const night = useful.find((c) => c.kind === 'overnight');
    const next = night && night.inS <= earliest.inS + STOP_DEFAULTS.mergeWindowS ? night : earliest;

    const stopWall = wall + next.inS * 1000;
    const joined = useful.filter((c) => {
      if (c === next) return true;
      if (c.inS > next.inS + (next.kind === 'overnight' ? 0 : STOP_DEFAULTS.mergeWindowS)) return false;
      if (c.kind === 'meal') return next.kind === 'overnight' || mealWindowOk(stopWall, tz);
      return true;
    });
    const kinds = [...new Set(joined.map((c) => c.kind))];
    const isOvernight = kinds.includes('overnight');

    T += next.inS;
    wall = stopWall;
    along = alongAtTime(profile, T);
    drivenToday += next.inS;
    sinceRest += next.inS;

    const stopTz = input.tzAt(along);
    let dwellS: number;
    if (isOvernight) {
      const morning = atLocalHour(wall, stopTz, pace.morningStartHour, localHour(wall, stopTz) >= 12 ? 1 : 0);
      dwellS = Math.max(pace.minOvernightS, (morning - wall) / 1000);
    } else {
      dwellS = Math.max(
        kinds.includes('rest') ? pace.restS : 0,
        kinds.includes('meal') ? STOP_DEFAULTS.mealS : 0,
        kinds.includes('fuel') ? STOP_DEFAULTS.fuelS : 0,
        kinds.includes('charge') ? STOP_DEFAULTS.chargeS : 0,
      );
    }

    stops.push({
      kinds: isOvernight ? ['overnight', ...kinds.filter((k) => k === 'fuel' || k === 'charge')] : kinds,
      alongM: along,
      driveTimeS: T,
      arriveMs: wall,
      departMs: wall + dwellS * 1000,
      dwellS,
      day,
      why: [...new Set(joined.map((c) => c.why))],
    });

    if (isOvernight || kinds.includes('rest') || kinds.includes('meal') || (kinds.includes('charge') && STOP_DEFAULTS.chargeS >= pace.restS)) sinceRest = 0;
    for (const c of joined) if (c.mealKey) eaten.add(c.mealKey);
    if (isOvernight) eaten.add(`${dateKey(wall, stopTz)}:dinner`);
    if (kinds.includes('fuel') || kinds.includes('charge')) {
      fillAlongM = along;
      fillRangeM = fullRangeM;
    }
    wall += dwellS * 1000;
    if (isOvernight) {
      drivenToday = 0;
      day++;
      dayStart = wall;
    }
  }

  return { stops, startAlongM: input.startAlongM, startMs: input.startMs, arriveMs: wall + Math.max(0, profile.totalTimeS - T) * 1000, days: day + 1 };
}

function mealWindowOk(ms: number, tz: string): boolean {
  const h = localHour(ms, tz);
  const [ls, le] = STOP_DEFAULTS.lunch;
  const [ds, de] = STOP_DEFAULTS.dinner;
  return (h >= ls - 0.5 && h < le) || (h >= ds - 0.5 && h < de);
}

/** Drive-seconds until the next usable meal window, and its key. */
function nextMeal(wall: number, tz: string, eaten: Set<string>, drivenToday: number): { inS: number; key: string } | null {
  const windows: [string, [number, number]][] = [
    ['lunch', STOP_DEFAULTS.lunch],
    ['dinner', STOP_DEFAULTS.dinner],
  ];
  for (const dayOffset of [0, 1]) {
    for (const [name, [startH, endH]] of windows) {
      const start = atLocalHour(wall, tz, startH, dayOffset);
      const end = atLocalHour(wall, tz, endH, dayOffset);
      const key = `${dateKey(start, tz)}:${name}`;
      if (eaten.has(key) || end <= wall) continue;
      const needS = Math.max(0, STOP_DEFAULTS.minDriveBeforeMealS - drivenToday);
      const inS = Math.max((Math.max(start, wall) - wall) / 1000, needS);
      if (wall + inS * 1000 < end) return { inS, key };
    }
  }
  return null;
}

/**
 * Drive-seconds until the overnight stay is due, and why. The latest arrival
 * is the first `latestArrivalHour` at least 3 h after this driving day began —
 * so someone who sets off at 23:00 drives a normal day (the daily limit) and
 * is not told to stop at 01:00.
 */
function overnightIn(wall: number, tz: string, pace: PacePreset, drivenToday: number, dayStart: number): { inS: number; why: 'daily-limit' | 'latest-arrival' } {
  const dailyLeft = Math.max(0, pace.dailyDriveS - drivenToday);
  let latest = atLocalHour(dayStart, tz, pace.latestArrivalHour);
  if (latest < dayStart + 3 * 3600_000) latest = atLocalHour(dayStart, tz, pace.latestArrivalHour, 1);
  const latestIn = Math.max(0, (latest - wall) / 1000);
  return latestIn < dailyLeft ? { inS: latestIn, why: 'latest-arrival' } : { inS: dailyLeft, why: 'daily-limit' };
}

/**
 * Planned wall-clock time (UTC ms) at an along-route position: driving time
 * from the start plus every stop reached before it. Positions before the
 * schedule's start get its start time.
 */
export function wallAtAlong(schedule: Schedule, profile: RouteProfile, alongM: number): number {
  const T0 = timeAtAlong(profile, schedule.startAlongM);
  const T = timeAtAlong(profile, Math.max(alongM, schedule.startAlongM));
  let dwell = 0;
  for (const s of schedule.stops) if (s.driveTimeS < T - 0.5) dwell += s.dwellS;
  return schedule.startMs + (T - T0 + dwell) * 1000;
}
