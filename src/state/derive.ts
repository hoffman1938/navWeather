import type { RouteCamera } from '../algorithms/cameras';
import type { RouteIncident } from '../algorithms/incidents';
import { routeVia } from '../algorithms/routeAlternatives';
import { buildRoadForecast, type RoadForecast } from '../algorithms/roadForecast';
import { roadAhead, wholeRoad, type OptionRoad } from '../algorithms/roadAhead';
import { coincidesAhead, roadsNearCar } from '../algorithms/roadMatching';
import { buildCurrentPoint, buildRouteWeatherPoints, reconcilePoints } from '../algorithms/routeWeather';
import { computeArrivals } from '../algorithms/routeTiming';
import { buildTimelineItems, type TimelineItem } from '../algorithms/timeline';
import {
  groupWeather,
  selectDisplayPoints,
  summarizeRouteWeather,
  weatherRouteSegments,
} from '../algorithms/weatherGrouping';
import type { SpeedLimitProfile } from '../algorithms/speedLimits';
import { isPrecipitating } from '../algorithms/weatherMatching';
import type { Messages } from '../i18n/en';
import type { UnitPrefs } from '../i18n/format';
import { buildRouteIntelligence, type RouteIntelligence } from '../intelligence/routeIntelligence';
import type { RouteEvent } from '../intelligence/types';
import type { WeatherAlertPrefs } from '../intelligence/weatherAlerts';
import { buildManeuvers, type Maneuver } from '../navigation/maneuvers';
import type { PlannedRoute } from '../services/routePlanner';
import type { LngLat } from '../types/geo';
import type { NavigationMode, RouteProgress } from '../types/navigation';
import type { RouteSample, TimedRoute } from '../types/route';
import type { TripStop } from '../trip/types';
import type {
  LocationForecast,
  RouteWeatherPoint,
  RouteWeatherSummary,
  WeatherGroup,
  WeatherRouteSegment,
} from '../types/weather';

export type ExposureKind = 'heavy' | 'storm' | 'snow' | 'fog' | 'wind' | 'rain';

export interface RouteOptionSummary {
  index: number;
  distanceM: number;
  durationS: number;
  /** Arrival (UTC ms) if this road is taken from its own start time. */
  arrivalMs: number;
  /** The roads it mostly follows, longest first ("E60", "S12"); empty when the router names none. */
  via: string[];
  /** Minutes of the drive expected in each condition (at the ETAs). */
  wetMinutes: number;
  heavyMinutes: number;
  exposure: Record<ExposureKind, number>;
  hasWeather: boolean;
  /** The forecast along this road — headline, ribbon, stops; null until a forecast has arrived. */
  forecast: RoadForecast | null;
  classes: string[];
}

/** A road the driver can still take from here, compared with the one being driven. */
export interface OtherRoadSummary extends RouteOptionSummary {
  /** Seconds slower (+) or faster (−) than staying on the current road, from here. */
  deltaS: number;
}

export interface Derived {
  /** Every sample with its arrival-time weather (incl. passed ones). */
  points: RouteWeatherPoint[];
  /** Points still ahead of the vehicle (all points while planning). */
  upcoming: RouteWeatherPoint[];
  /** The few points shown as cards AND map markers (same list → always in sync). */
  displayPoints: RouteWeatherPoint[];
  /** "Now" at the vehicle position while navigating. */
  currentPoint: RouteWeatherPoint | null;
  timelineItems: TimelineItem[];
  groups: WeatherGroup[];
  summary: RouteWeatherSummary | null;
  routeSegments: WeatherRouteSegment[];
  maneuvers: Maneuver[];
  intelligence: RouteIntelligence;
  options: RouteOptionSummary[];
  /** While driving: other roads to the destination still within reach, fastest first. */
  otherRoads: OtherRoadSummary[];
  departureMs: number;
  arrivalMs: number | null;
}

const emptyIntelligence: RouteIntelligence = { events: [], nextWeather: null, ahead: [] };

export const emptyDerived: Derived = {
  points: [],
  upcoming: [],
  displayPoints: [],
  currentPoint: null,
  timelineItems: [],
  groups: [],
  summary: null,
  routeSegments: [],
  maneuvers: [],
  intelligence: emptyIntelligence,
  options: [],
  otherRoads: [],
  departureMs: 0,
  arrivalMs: null,
};

export interface DeriveInput {
  plan: PlannedRoute | null;
  /** All route options (primary first) — for the weather comparison while planning. */
  options: PlannedRoute[];
  /** Roads known to the destination while driving (the current one included). */
  knownRoads: PlannedRoute[];
  forecastFor: (s: RouteSample) => LocationForecast | undefined;
  mode: NavigationMode;
  /** Planning: chosen departure. Navigating: when this route leg started. */
  departureMs: number;
  /** Real now, or the simulated clock. */
  nowMs: number;
  progress: RouteProgress | null;
  vehicleCoordinate: LngLat | null;
  fallbackTimeZone: string;
  m: Messages;
  units: UnitPrefs;
  weatherPrefs: WeatherAlertPrefs;
  speedLimits: SpeedLimitProfile | null;
  fuelRangeKm: number | null;
  vehicle?: 'fuel' | 'ev';
  incidents?: RouteIncident[];
  breakReminders?: boolean;
  speedCameras?: RouteCamera[];
  extraEvents: RouteEvent[];
  /**
   * Long Trip Mode's planned stops (rests, meals, fuel, nights): their
   * durations are added to every ETA after them, so forecasts are matched to
   * the times you'll really be there. Absent outside Long Trip Mode.
   */
  tripStops?: TripStop[];
  previous: Derived;
}

/** Seconds of planned stops strictly between two along-route positions. */
export function dwellBetweenStops(stops: TripStop[] | undefined, fromM: number, toM: number): number {
  if (!stops?.length) return 0;
  let s = 0;
  for (const st of stops) if (st.alongM > fromM + 1 && st.alongM < toM - 1) s += st.dwellMinutes * 60;
  return s;
}

let maneuverMemo: { timed: TimedRoute; list: Maneuver[] } | null = null;
function maneuversFor(timed: TimedRoute): Maneuver[] {
  if (maneuverMemo?.timed !== timed) maneuverMemo = { timed, list: buildManeuvers(timed) };
  return maneuverMemo.list;
}

/** Timezone for points without a forecast: nearest point that has one. */
function nearestTimeZone(samples: RouteSample[], forecastFor: DeriveInput['forecastFor'], i: number, fallback: string) {
  for (let d = 0; d < samples.length; d++) {
    for (const j of [i - d, i + d]) {
      const f = j >= 0 && j < samples.length ? forecastFor(samples[j]) : undefined;
      if (f?.timezone) return f.timezone;
    }
  }
  return fallback;
}

export function deriveRouteWeather(input: DeriveInput): Derived {
  const { plan, mode, progress, previous, m, units } = input;
  if (!plan) return emptyDerived;
  const navigating = mode !== 'planning' && progress !== null;
  const samples = plan.samples;
  const fallbackTz = nearestTimeZone(samples, input.forecastFor, 0, input.fallbackTimeZone);

  const clock = navigating
    ? ({ mode: 'navigating', nowMs: input.nowMs, modelTimeS: progress.modelTimeS, departureMs: input.departureMs } as const)
    : ({ mode: 'planning', departureMs: input.departureMs } as const);
  // Planned stops ahead of the car (or of the start) push every later ETA back.
  const fromM = navigating ? progress.distanceAlongM : 0;
  const stops = input.tripStops;
  const dwellBeforeS = stops?.length ? (toM: number) => dwellBetweenStops(stops, fromM, toM) : undefined;
  const arrivals = computeArrivals(samples, clock).map((a, i) => (dwellBeforeS ? a + dwellBeforeS(samples[i].distanceM) * 1000 : a));
  const rawPoints = buildRouteWeatherPoints({
    samples,
    arrivals,
    forecastFor: input.forecastFor,
    nowMs: input.nowMs,
    progressM: navigating ? progress.distanceAlongM : null,
    modelTimeS: navigating ? progress.modelTimeS : 0,
    fallbackTimeZone: fallbackTz,
  });
  const points = reconcilePoints(previous.points, rawPoints);
  const upcoming = navigating ? points.filter((p) => p.status !== 'passed') : points;

  let currentPoint: RouteWeatherPoint | null = null;
  if (navigating && input.vehicleCoordinate) {
    const c = buildCurrentPoint({
      coordinate: input.vehicleCoordinate,
      distanceAlongM: progress.distanceAlongM,
      samples,
      forecastFor: input.forecastFor,
      nowMs: input.nowMs,
      fallbackTimeZone: fallbackTz,
    });
    currentPoint = c ? (reconcilePoints(previous.currentPoint ? [previous.currentPoint] : [], [c])[0] ?? c) : null;
  }

  const maneuvers = maneuversFor(plan.timed);
  const intelligence = buildRouteIntelligence({
    timed: plan.timed,
    maneuvers,
    progressM: navigating ? progress.distanceAlongM : 0,
    clock: navigating
      ? { mode: 'navigating', nowMs: input.nowMs, modelTimeS: progress.modelTimeS, dwellBeforeS }
      : { mode: 'planning', departureMs: input.departureMs, dwellBeforeS },
    tripStops: stops,
    weatherPoints: points,
    currentPoint,
    weatherPrefs: input.weatherPrefs,
    speedLimits: input.speedLimits,
    fuelRangeKm: input.fuelRangeKm,
    vehicle: input.vehicle,
    incidents: input.incidents,
    breakReminders: input.breakReminders,
    speedCameras: input.speedCameras,
    extraEvents: input.extraEvents,
    m,
    units,
  });

  // Cards/markers: selected over the whole route (stable while driving), passed ones hidden.
  const eventPointIds = new Set(
    intelligence.events.filter((e) => e.category === 'weather').map((e) => e.id.split('@')[1]),
  );
  const selected = selectDisplayPoints(points, { includeFirst: true, eventPointIds });
  const displayPoints = stableArray(
    previous.displayPoints,
    navigating ? selected.filter((p) => p.status !== 'passed') : selected,
  );

  const ahead = currentPoint ? [currentPoint, ...upcoming] : upcoming;
  const timelineItems = stableItems(
    previous.timelineItems,
    buildTimelineItems(currentPoint ? [currentPoint, ...displayPoints] : displayPoints),
  );
  const groups = stableJson(previous.groups, groupWeather(ahead, m));
  const summary = stableJson(previous.summary, summarizeRouteWeather(ahead, m, units.temperature));
  const routeSegments = stableJson(previous.routeSegments, weatherRouteSegments(points, plan.timed.totalDistM));

  const options =
    !navigating && input.options.length > 1
      ? stableJson(
          previous.options,
          // A public-transport trip starts at its own timetabled time; a road whenever you leave.
          input.options.map((o, i) =>
            summarizeOption(
              wholeRoad(o),
              i,
              input,
              o.timed.route.transit?.departMs ?? input.departureMs,
              // The trip plan belongs to the chosen road: its card shows the times with the planned stops.
              o === plan && dwellBeforeS ? dwellBeforeS : undefined,
            ),
          ),
        )
      : [];
  const otherRoads = navigating ? stableJson(previous.otherRoads, summarizeOtherRoads(input, plan, progress)) : [];

  const arrivalMs =
    (navigating ? progress.etaMs : input.departureMs + plan.timed.totalTimeS * 1000) + (dwellBeforeS ? dwellBeforeS(plan.timed.totalDistM + 2) * 1000 : 0);

  return {
    points,
    upcoming: stableArray(previous.upcoming, upcoming),
    displayPoints,
    currentPoint,
    timelineItems,
    groups,
    summary,
    routeSegments,
    maneuvers,
    intelligence: stableIntelligence(previous.intelligence, intelligence),
    options,
    otherRoads,
    departureMs: input.departureMs,
    arrivalMs,
  };
}

/**
 * What a road offers: its forecast at the ETAs, and the minutes it spends in
 * rain / heavy rain / storm / snow / fog / strong gusts. `departureMs` is when
 * the road would be started (the plan's departure, or now for roads from the car).
 */
export function summarizeOption(
  o: OptionRoad,
  index: number,
  input: DeriveInput,
  departureMs = input.departureMs,
  dwellBeforeS?: (alongM: number) => number,
): RouteOptionSummary {
  const dwell = (m: number) => (dwellBeforeS ? dwellBeforeS(m) * 1000 : 0);
  let wet = 0;
  let heavy = 0;
  let has = false;
  const ex: Record<ExposureKind, number> = { heavy: 0, storm: 0, snow: 0, fog: 0, wind: 0, rain: 0 };
  const s = o.samples;
  const points = buildRouteWeatherPoints({
    samples: s,
    arrivals: s.map((smp) => departureMs + smp.travelTimeS * 1000 + dwell(smp.distanceM)),
    forecastFor: input.forecastFor,
    nowMs: input.nowMs,
    progressM: null,
    modelTimeS: 0,
    fallbackTimeZone: nearestTimeZone(s, input.forecastFor, 0, input.fallbackTimeZone),
  });
  for (let i = 0; i < s.length; i++) {
    const w = points[i].weather;
    if (!w) continue;
    has = true;
    const next = s[i + 1]?.travelTimeS ?? s[i].travelTimeS;
    const prev = s[i - 1]?.travelTimeS ?? s[i].travelTimeS;
    const span = (next - prev) / 2 / 60;
    if (isPrecipitating(w.condition)) wet += span;
    const isHeavy = w.condition === 'HEAVY_RAIN' || w.condition === 'THUNDERSTORM' || (w.precipitation ?? 0) >= 4;
    if (isHeavy) heavy += span;
    if (w.condition === 'THUNDERSTORM') ex.storm += span;
    else if (w.condition === 'SNOW' || w.condition === 'SLEET') ex.snow += span;
    else if (isHeavy) ex.heavy += span;
    else if (w.condition === 'RAIN') ex.rain += span;
    if (w.condition === 'FOG' || (w.visibility !== undefined && w.visibility < 1000)) ex.fog += span;
    if ((w.windGusts ?? 0) >= 70) ex.wind += span;
  }
  const classes = [...new Set(o.route.legs.flatMap((l) => l.steps.flatMap((st) => st.classes ?? [])))];
  return {
    index,
    distanceM: o.totalDistM,
    durationS: o.totalTimeS,
    arrivalMs: departureMs + o.totalTimeS * 1000 + dwell(o.totalDistM + 2),
    via: routeVia(o.route),
    wetMinutes: Math.round(wet),
    heavyMinutes: Math.round(heavy),
    exposure: Object.fromEntries(Object.entries(ex).map(([k, v]) => [k, Math.round(v)])) as Record<ExposureKind, number>,
    hasWeather: has,
    forecast: buildRoadForecast(points, o.totalDistM, input.m, input.units.temperature),
    classes,
  };
}

/**
 * Other roads to the destination that the car can still take: known roads it
 * is on or beside, that don't just follow the current road to the end.
 * Each is the part still ahead, with its forecast for the times you'd be there.
 */
function summarizeOtherRoads(input: DeriveInput, plan: PlannedRoute, progress: RouteProgress): OtherRoadSummary[] {
  const car = input.vehicleCoordinate;
  if (!car || input.knownRoads.length < 2) return [];
  const currentRemainingS = plan.timed.totalTimeS - progress.modelTimeS;
  const out: OtherRoadSummary[] = [];
  for (const { index, distanceAlongM } of roadsNearCar(input.knownRoads.map((o) => o.timed), car)) {
    const road = input.knownRoads[index];
    if (road.timed === plan.timed || road.timed.totalDistM - distanceAlongM < 1000) continue;
    if (coincidesAhead(road.timed, distanceAlongM, plan.timed)) continue;
    const ahead = roadAhead(road, distanceAlongM);
    out.push({ ...summarizeOption(ahead, index, input, input.nowMs), deltaS: ahead.totalTimeS - currentRemainingS });
  }
  return out.sort((a, b) => a.durationS - b.durationS);
}

function stableArray<T>(prev: T[], next: T[]): T[] {
  if (prev.length === next.length && prev.every((x, i) => x === next[i])) return prev;
  return next;
}

function stableItems(prev: TimelineItem[], next: TimelineItem[]): TimelineItem[] {
  if (
    prev.length === next.length &&
    prev.every((x, i) => {
      const y = next[i];
      if (x.type !== y.type || x.id !== y.id) return false;
      return x.type === 'point' ? x.point === (y as typeof x).point : x.localTime === (y as typeof x).localTime;
    })
  ) {
    return prev;
  }
  return next;
}

/** Re-use the previous intelligence object when nothing a user can see changed. */
function stableIntelligence(prev: RouteIntelligence, next: RouteIntelligence): RouteIntelligence {
  const sig = (i: RouteIntelligence) =>
    i.ahead.map((e) => `${e.id}|${e.severity}|${e.estimatedMinutesFromCurrent}|${Math.round(e.distanceFromCurrentM / 100)}`).join(';') +
    `#${i.events.length}#${i.nextWeather?.id ?? ''}`;
  return sig(prev) === sig(next) ? { ...next, ahead: prev.ahead } : next;
}

function stableJson<T>(prev: T, next: T): T {
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}
