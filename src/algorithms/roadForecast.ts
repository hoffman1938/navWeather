import type { Messages } from '../i18n/en';
import type { TemperatureUnit } from '../i18n/format';
import type { RouteWeatherPoint, RouteWeatherSummary, WeatherCondition, WeatherGroupClass } from '../types/weather';
import { selectDisplayPoints, summarizeRouteWeather, weatherRibbon } from './weatherGrouping';

/** One forecast stop on a road: where/when you'd be there and what to expect. */
export interface RoadForecastStop {
  id: string;
  placeName?: string;
  distanceKm: number;
  arrivalMs: number;
  /** "HH:mm" at the stop. */
  localTime: string;
  condition: WeatherCondition;
  isDay: boolean;
  temperature: number;
  precipitationProbability?: number;
}

/** A stretch of the road by weather, as fractions (0–1) of its length. */
export interface RibbonSegment {
  from: number;
  to: number;
  groupClass: WeatherGroupClass;
}

/**
 * What the weather along ONE road looks like, for choosing between roads:
 * a headline, the temperature range, the whole road as a coloured ribbon and
 * a few stops with the forecast for the time you'd be there.
 */
export interface RoadForecast {
  headline: string;
  tone: RouteWeatherSummary['tone'];
  headlineCondition?: WeatherCondition;
  minTemperature?: number;
  maxTemperature?: number;
  ribbon: RibbonSegment[];
  stops: RoadForecastStop[];
}

/** null when no point of the road has a forecast yet. */
export function buildRoadForecast(
  points: RouteWeatherPoint[],
  totalDistM: number,
  m: Messages,
  temperatureUnit: TemperatureUnit,
  maxStops = 4,
): RoadForecast | null {
  const withWeather = points.filter((p) => p.weather !== null);
  if (withWeather.length === 0 || totalDistM <= 0) return null;
  const summary = summarizeRouteWeather(withWeather, m, temperatureUnit);
  const ribbon = weatherRibbon(withWeather, totalDistM).map((s) => ({
    from: Math.max(0, Math.min(1, s.startM / totalDistM)),
    to: Math.max(0, Math.min(1, s.endM / totalDistM)),
    groupClass: s.groupClass,
  }));
  const stops = selectDisplayPoints(withWeather, { includeFirst: true, maxCards: maxStops }).map((p): RoadForecastStop => {
    const w = p.weather!;
    return {
      id: p.id,
      placeName: p.placeName,
      distanceKm: p.distanceFromStartKm,
      arrivalMs: p.arrivalMs,
      localTime: p.localTime,
      condition: w.condition,
      isDay: w.isDay,
      temperature: w.temperature,
      precipitationProbability: w.precipitationProbability,
    };
  });
  return {
    headline: summary.headline,
    tone: summary.tone,
    headlineCondition: summary.headlineCondition,
    minTemperature: summary.minTemperature,
    maxTemperature: summary.maxTemperature,
    ribbon,
    stops,
  };
}
