/** Provider-independent weather conditions. The UI only ever sees these. */
export const WEATHER_CONDITIONS = [
  'CLEAR',
  'PARTLY_CLOUDY',
  'CLOUDY',
  'FOG',
  'RAIN',
  'HEAVY_RAIN',
  'SNOW',
  'SLEET',
  'THUNDERSTORM',
] as const;

export type WeatherCondition = (typeof WEATHER_CONDITIONS)[number];

/**
 * Normalized hourly forecast for one location. Arrays are aligned with
 * `times` (UTC epoch ms, start of each hour).
 *
 * Semantics (matters for arrival-time matching):
 *  - instant values: temperature, apparentTemperature, cloudCover, wind*, visibility, humidity, condition
 *  - preceding-hour values: precipitation, rain, snowfall, precipitationProbability
 *    (the value at T describes the interval T-1h … T)
 */
export interface LocationForecast {
  locationKey: string;
  latitude: number;
  longitude: number;
  elevationM?: number;
  /** IANA timezone of the location, e.g. "Asia/Tbilisi". */
  timezone: string;
  times: number[];
  hourly: {
    temperature: (number | null)[];
    apparentTemperature: (number | null)[];
    precipitationProbability: (number | null)[];
    precipitation: (number | null)[];
    rain: (number | null)[];
    snowfall: (number | null)[];
    condition: (WeatherCondition | null)[];
    description: (string | null)[];
    cloudCover: (number | null)[];
    windSpeed: (number | null)[];
    windGusts: (number | null)[];
    windDirection: (number | null)[];
    visibility: (number | null)[];
    humidity: (number | null)[];
  };
  provider: string;
  fetchedAt: number;
  /** Model run time if the provider exposes it. */
  forecastGeneratedAt?: number;
}

/** Weather expected at one place at one moment (the arrival time). */
export interface WeatherAtTime {
  temperature: number;
  feelsLike?: number;
  condition: WeatherCondition;
  description?: string;
  /** %, for the forecast hour containing the arrival — never interpolated. */
  precipitationProbability?: number;
  /** mm in the forecast hour containing the arrival. */
  precipitation?: number;
  rain?: number;
  /** cm in the forecast hour containing the arrival. */
  snowfall?: number;
  /** km/h */
  windSpeed?: number;
  windGusts?: number;
  windDirection?: number;
  /** m */
  visibility?: number;
  cloudCover?: number;
  humidity?: number;
  isDay: boolean;
  /** Forecast hour (UTC ms) used for categorical values. */
  forecastHourUtc: number;
}

export type ForecastConfidence = 'high' | 'medium' | 'low';

export type PointStatus = 'passed' | 'current' | 'upcoming';

export interface RouteWeatherPoint {
  id: string;
  latitude: number;
  longitude: number;
  distanceFromStartKm: number;
  /** Travel minutes from route start (planning) — or from now (navigating). */
  estimatedTravelMinutes: number;
  estimatedArrivalUtc: string;
  arrivalMs: number;
  /** "HH:mm" in the point's own timezone. */
  localTime: string;
  timezone: string;
  placeName?: string;
  placeRelation?: 'in' | 'near';
  /** Settlement type when the name came from OSM places (absent for reverse-geocoded names). */
  placeKind?: import('./route').PlaceKind;
  elevationM?: number;
  /** null → weather unavailable for this point (keep navigation working). */
  weather: WeatherAtTime | null;
  forecastLeadHours: number;
  confidence: ForecastConfidence;
  status: PointStatus;
  reasons: import('./route').SampleReason[];
}

export type WeatherGroupClass =
  | 'clear'
  | 'cloudy'
  | 'fog'
  | 'rain'
  | 'heavy-rain'
  | 'snow'
  | 'sleet'
  | 'thunderstorm';

/** Consecutive route stretch with similar weather. */
export interface WeatherGroup {
  id: string;
  groupClass: WeatherGroupClass;
  condition: WeatherCondition;
  label: string;
  fromPointId: string;
  toPointId: string;
  fromName?: string;
  toName?: string;
  startDistanceM: number;
  endDistanceM: number;
  startArrivalMs: number;
  endArrivalMs: number;
  maxPrecipitationProbability?: number;
  minTemperature?: number;
  maxTemperature?: number;
  pointIds: string[];
}

export type WeatherEventType =
  | 'rain-start'
  | 'rain-end'
  | 'snow-start'
  | 'heavy-precipitation'
  | 'thunderstorm'
  | 'strong-wind'
  | 'temperature-drop'
  | 'low-visibility'
  | 'icy';

export interface WeatherEvent {
  id: string;
  type: WeatherEventType;
  pointId: string;
  message: string;
  severity: 'info' | 'caution' | 'warning';
  arrivalMs: number;
  distanceM: number;
}

export interface RouteWeatherSummary {
  headline: string;
  detail?: string;
  tone: 'dry' | 'wet' | 'wintry' | 'severe' | 'unknown';
  minTemperature?: number;
  maxTemperature?: number;
  /** The condition the headline talks about (for its icon). */
  headlineCondition?: WeatherCondition;
  /** Short per-stretch lines, e.g. "Rain likely near Khashuri". */
  highlights: { condition: WeatherCondition; text: string; isDay: boolean }[];
}

/** Colored stretch of the route line on the map (only for notable weather). */
export interface WeatherRouteSegment {
  startM: number;
  endM: number;
  groupClass: WeatherGroupClass;
}
