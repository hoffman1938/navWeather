import { buildCurrentPoint, buildRouteWeatherPoints, reconcilePoints } from '../algorithms/routeWeather';
import { computeArrivals } from '../algorithms/routeTiming';
import { buildTimelineItems, type TimelineItem } from '../algorithms/timeline';
import {
  detectWeatherEvents,
  groupWeather,
  selectDisplayPoints,
  summarizeRouteWeather,
  weatherRouteSegments,
} from '../algorithms/weatherGrouping';
import type { PlannedRoute } from '../services/routePlanner';
import type { LngLat } from '../types/geo';
import type { NavigationMode, RouteProgress } from '../types/navigation';
import type { RouteSample } from '../types/route';
import type {
  LocationForecast,
  RouteWeatherPoint,
  RouteWeatherSummary,
  WeatherEvent,
  WeatherGroup,
  WeatherRouteSegment,
} from '../types/weather';

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
  events: WeatherEvent[];
  summary: RouteWeatherSummary | null;
  routeSegments: WeatherRouteSegment[];
  departureMs: number;
  arrivalMs: number | null;
}

export const emptyDerived: Derived = {
  points: [],
  upcoming: [],
  displayPoints: [],
  currentPoint: null,
  timelineItems: [],
  groups: [],
  events: [],
  summary: null,
  routeSegments: [],
  departureMs: 0,
  arrivalMs: null,
};

export interface DeriveInput {
  plan: PlannedRoute | null;
  forecastFor: (s: RouteSample) => LocationForecast | undefined;
  mode: NavigationMode;
  /** Planning: chosen departure. Navigating: when this route leg started. */
  departureMs: number;
  /** Real now, or the simulated clock. */
  nowMs: number;
  progress: RouteProgress | null;
  vehicleCoordinate: LngLat | null;
  fallbackTimeZone: string;
  previous: Derived;
}

export function deriveRouteWeather(input: DeriveInput): Derived {
  const { plan, mode, progress, previous } = input;
  if (!plan) return emptyDerived;
  const navigating = mode !== 'planning' && progress !== null;
  const samples = plan.samples;

  const arrivals = computeArrivals(
    samples,
    navigating
      ? { mode: 'navigating', nowMs: input.nowMs, modelTimeS: progress.modelTimeS, departureMs: input.departureMs }
      : { mode: 'planning', departureMs: input.departureMs },
  );
  const rawPoints = buildRouteWeatherPoints({
    samples,
    arrivals,
    forecastFor: input.forecastFor,
    nowMs: input.nowMs,
    progressM: navigating ? progress.distanceAlongM : null,
    modelTimeS: navigating ? progress.modelTimeS : 0,
    fallbackTimeZone: input.fallbackTimeZone,
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
      fallbackTimeZone: input.fallbackTimeZone,
    });
    currentPoint = c ? (reconcilePoints(previous.currentPoint ? [previous.currentPoint] : [], [c])[0] ?? c) : null;
  }

  // Select cards over the whole route (stable while driving), then hide passed ones.
  const selected = selectDisplayPoints(points, { includeFirst: true });
  const displayPoints = stableArray(
    previous.displayPoints,
    navigating ? selected.filter((p) => p.status !== 'passed') : selected,
  );

  const ahead = currentPoint ? [currentPoint, ...upcoming] : upcoming;
  const timelineItems = stableItems(
    previous.timelineItems,
    buildTimelineItems(currentPoint ? [currentPoint, ...displayPoints] : displayPoints),
  );
  const groups = stableJson(previous.groups, groupWeather(ahead));
  const events = stableJson(previous.events, detectWeatherEvents(ahead));
  const summary = stableJson(previous.summary, summarizeRouteWeather(ahead));
  const routeSegments = stableJson(previous.routeSegments, weatherRouteSegments(points, plan.timed.totalDistM));

  const arrivalMs = navigating
    ? progress.etaMs
    : input.departureMs + plan.timed.totalTimeS * 1000;

  return {
    points,
    upcoming: stableArray(previous.upcoming, upcoming),
    displayPoints,
    currentPoint,
    timelineItems,
    groups,
    events,
    summary,
    routeSegments,
    departureMs: input.departureMs,
    arrivalMs,
  };
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

function stableJson<T>(prev: T, next: T): T {
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}
