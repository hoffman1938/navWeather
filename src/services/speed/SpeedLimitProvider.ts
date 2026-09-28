import type { LngLat } from '../../types/geo';

/** A road stretch with a posted limit (km/h) from map data. */
export interface SpeedLimitWay {
  kmh: number;
  geometry: LngLat[];
}

/** A fixed speed camera from map data (only where the user enabled camera alerts). */
export interface SpeedCamera {
  id: string;
  coordinate: LngLat;
  /** Enforced limit when mapped, km/h. */
  kmh?: number;
}

export interface SpeedLimitProvider {
  readonly name: string;
  /** Tagged speed limits for roads along the route geometry (may be incomplete). */
  getSpeedLimits(route: LngLat[], signal?: AbortSignal): Promise<SpeedLimitWay[]>;
  /** Mapped speed cameras along the route (may be incomplete). */
  getSpeedCameras?(route: LngLat[], signal?: AbortSignal): Promise<SpeedCamera[]>;
}
