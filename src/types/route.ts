import type { BBox, LngLat, Place } from './geo';

/** Where per-vertex travel times came from, most accurate first. */
export type TimingSource = 'annotations' | 'steps' | 'proportional';

/**
 * A stretch of the route geometry with a travel duration.
 *
 * This is the ETA abstraction: the routing provider fills `durationS`
 * (typical, no live traffic). A future TrafficProvider only needs to set
 * `currentDurationS` — route timing prefers it — and the whole weather
 * pipeline re-times itself without any other change.
 */
export interface RouteSegment {
  /** Geometry vertex index where the segment starts. */
  fromIndex: number;
  /** Geometry vertex index where the segment ends (> fromIndex). */
  toIndex: number;
  distanceM: number;
  durationS: number;
  /** Traffic-adjusted duration, when a traffic provider is available. */
  currentDurationS?: number;
  speedMps?: number;
}

export interface RouteStep {
  distanceM: number;
  durationS: number;
  name: string;
  ref?: string;
  maneuverType: string;
  maneuverModifier?: string;
  location: LngLat;
  /** Geometry vertex range covered by this step, when it could be aligned. */
  fromIndex?: number;
  toIndex?: number;
}

export interface RouteLeg {
  distanceM: number;
  durationS: number;
  summary: string;
  steps: RouteStep[];
}

export interface Route {
  id: string;
  provider: string;
  origin: Place;
  destination: Place;
  /** Full-resolution road geometry. */
  geometry: LngLat[];
  distanceM: number;
  durationS: number;
  legs: RouteLeg[];
  segments: RouteSegment[];
  /** Granularity of `segments`. */
  segmentSource: TimingSource;
  bbox: BBox;
  computedAt: number;
}

/**
 * A route with cumulative distance and travel time for every geometry vertex.
 * This is what answers "where will I be after N minutes?" and vice versa.
 */
export interface TimedRoute {
  route: Route;
  /** Cumulative great-circle distance per vertex (m), starts at 0. */
  cumDistM: Float64Array;
  /** Cumulative travel time per vertex (s), starts at 0. */
  cumTimeS: Float64Array;
  totalDistM: number;
  totalTimeS: number;
  timingSource: TimingSource;
}

export type SampleReason =
  | 'origin'
  | 'destination'
  | 'settlement'
  | 'elevation'
  | 'junction'
  | 'turn'
  | 'time'
  | 'distance'
  | 'weather-change';

/** A route position selected for a weather lookup. */
export interface RouteSample {
  /** Stable id (route id + distance) — survives forecast refreshes. */
  id: string;
  coordinate: LngLat;
  distanceM: number;
  /** Travel time from the route start to here (s). */
  travelTimeS: number;
  reasons: SampleReason[];
  placeName?: string;
  /** 'in' = the sample is at the settlement, 'near' = closest named place. */
  placeRelation?: 'in' | 'near';
  placeKind?: PlaceKind;
  elevationM?: number;
}

export type PlaceKind = 'city' | 'town' | 'village';

/** A settlement snapped onto the route. */
export interface PlaceAlongRoute {
  id: string;
  name: string;
  kind: PlaceKind;
  population?: number;
  coordinate: LngLat;
  /** Distance along the route of the closest route point (m). */
  distanceAlongM: number;
  /** Perpendicular distance from the route (m). */
  offsetM: number;
}

export interface ElevationProfile {
  distancesM: number[];
  elevationsM: number[];
}
