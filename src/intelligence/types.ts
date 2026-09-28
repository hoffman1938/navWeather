import type { WeatherCondition } from '../types/weather';

/** Priority/severity used across all route intelligence. */
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export const SEVERITY_RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1, low: 0 };

export type WeatherAlertType =
  | 'RAIN_AHEAD'
  | 'HEAVY_RAIN_AHEAD'
  | 'SNOW_AHEAD'
  | 'THUNDERSTORM_AHEAD'
  | 'FOG_AHEAD'
  | 'LOW_VISIBILITY_AHEAD'
  | 'STRONG_WIND_AHEAD'
  | 'TEMPERATURE_DROP_AHEAD'
  | 'FREEZING_AHEAD'
  | 'WEATHER_CLEARING';

export type RouteEventType =
  | WeatherAlertType
  | 'SPEED_LIMIT_CHANGE'
  | 'FUEL_STOP'
  | 'CHARGE_STOP'
  | 'REST_BREAK'
  | 'DESTINATION'
  | 'STOP'
  | 'POI'
  | 'INCIDENT'
  | 'TRAFFIC';

export type EventCategory =
  | 'weather'
  | 'traffic'
  | 'incident'
  | 'poi'
  | 'speed'
  | 'fuel'
  | 'charging'
  | 'rest'
  | 'destination'
  | 'stop';

/** Semantic icon key (rendered by the UI; never an emoji in data). */
export type EventIcon =
  | 'rain'
  | 'heavy-rain'
  | 'snow'
  | 'storm'
  | 'fog'
  | 'wind'
  | 'cold'
  | 'ice'
  | 'clear'
  | 'speed'
  | 'fuel'
  | 'charging'
  | 'rest'
  | 'flag'
  | 'stop'
  | 'poi'
  | 'incident'
  | 'traffic';

/**
 * Normalized route event — the single currency of route intelligence.
 * Weather, speed limits, stops, places, and (future) traffic/incidents all
 * produce these; the UI and the voice layer consume only these.
 */
export interface RouteEvent {
  id: string;
  type: RouteEventType;
  category: EventCategory;
  severity: Severity;
  latitude: number;
  longitude: number;
  /** Along-route distance where the event starts (m). */
  distanceAlongM: number;
  /** Where a stretch-type event ends (m), if applicable. */
  endDistanceAlongM?: number;
  distanceFromCurrentM: number;
  estimatedMinutesFromCurrent: number;
  /** UTC ms. */
  estimatedArrivalTime: number;
  title: string;
  /** Short visual line (no timing; the UI adds "in 25 min"). */
  shortMessage: string;
  /** Natural spoken sentence with timing, e.g. "Heavy rain is expected in about 25 minutes, near Khashuri." */
  voiceMessage: string;
  icon: EventIcon;
  source: string;
  /** 0–1: forecast/probability/lead-time/report confidence. */
  confidence: number;
  /** UTC ms after which the event is irrelevant. */
  expiresAt: number;
  placeName?: string;
  condition?: WeatherCondition;
  isDay?: boolean;
}
