import type { LngLat } from '../../types/geo';

/** A road stretch with a posted limit (km/h) from map data. */
export interface SpeedLimitWay {
  kmh: number;
  geometry: LngLat[];
}

export interface SpeedLimitProvider {
  readonly name: string;
  /** Tagged speed limits for roads along the route geometry (may be incomplete). */
  getSpeedLimits(route: LngLat[], signal?: AbortSignal): Promise<SpeedLimitWay[]>;
}
