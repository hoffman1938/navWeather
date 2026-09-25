import type { RouteWeatherPoint, WeatherAtTime, WeatherCondition } from '../types/weather';

/** Short, friendly condition names for cards and markers. */
export const CONDITION_LABEL: Record<WeatherCondition, string> = {
  CLEAR: 'Clear',
  PARTLY_CLOUDY: 'Partly cloudy',
  CLOUDY: 'Cloudy',
  FOG: 'Fog',
  RAIN: 'Rain',
  HEAVY_RAIN: 'Heavy rain',
  SNOW: 'Snow',
  SLEET: 'Sleet',
  THUNDERSTORM: 'Thunderstorm',
};

export function conditionLabel(w: WeatherAtTime): string {
  if (w.condition === 'CLEAR' && !w.isDay) return 'Clear night';
  return CONDITION_LABEL[w.condition];
}

export function formatTemp(t: number | undefined): string {
  return t === undefined ? '–' : `${Math.round(t)}°`;
}

/** Precipitation chance worth showing (rounded to 5 % — no false precision). */
export function precipChance(w: WeatherAtTime | null): number | null {
  const p = w?.precipitationProbability;
  if (p === undefined || p === null || p < 15) return null;
  return Math.round(p / 5) * 5;
}

export function notableWind(w: WeatherAtTime | null): number | null {
  if (!w) return null;
  const gust = w.windGusts ?? 0;
  const speed = w.windSpeed ?? 0;
  if (gust >= 45 || speed >= 30) return Math.round(Math.max(gust, speed));
  return null;
}

export function placeLabel(p: RouteWeatherPoint): string {
  if (!p.placeName) return `km ${Math.round(p.distanceFromStartKm)}`;
  return p.placeRelation === 'near' ? `Near ${p.placeName}` : p.placeName;
}

export function confidenceLabel(p: RouteWeatherPoint): string | null {
  if (p.confidence === 'medium') return 'Less certain';
  if (p.confidence === 'low') return 'Low confidence';
  return null;
}

export function compassDir(deg: number | undefined): string {
  if (deg === undefined) return '';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

export function pointAriaLabel(p: RouteWeatherPoint, timeLabel: string): string {
  const w = p.weather;
  if (!w) return `${placeLabel(p)}, ${timeLabel}, weather unavailable`;
  const chance = precipChance(w);
  return [
    placeLabel(p),
    timeLabel,
    conditionLabel(w),
    `${Math.round(w.temperature)} degrees`,
    chance ? `${chance} percent chance of precipitation` : null,
    'forecast for your estimated arrival',
  ]
    .filter(Boolean)
    .join(', ');
}
