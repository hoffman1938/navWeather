import type { LngLat } from './geo';

export type NavigationMode = 'planning' | 'navigating' | 'simulating';

export interface VehicleState {
  coordinate: LngLat;
  headingDeg?: number;
  speedMps?: number;
  accuracyM?: number;
  timestampMs: number;
}

/** Where the vehicle is relative to the planned route. */
export interface RouteProgress {
  distanceAlongM: number;
  /** Route model time at the vehicle position (s from route start). */
  modelTimeS: number;
  distanceFromRouteM: number;
  segmentIndex: number;
  remainingDistanceM: number;
  remainingTimeS: number;
  /** Clock used for all ETAs (real time or simulated time). */
  nowMs: number;
  etaMs: number;
}

export type DeviationStatus = 'on-route' | 'uncertain' | 'off-route';

export interface DeviationState {
  status: DeviationStatus;
  consecutiveOff: number;
  offSinceMs: number | null;
  lastDistanceM: number;
  lastThresholdM: number;
}
