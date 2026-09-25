import type { WeatherCondition } from '../../types/weather';

/**
 * WMO weather interpretation codes (used by Open-Meteo) → normalized
 * conditions. Anything unknown maps to null so it can never masquerade as
 * a real condition.
 */
const WMO: Record<number, { condition: WeatherCondition; description: string }> = {
  0: { condition: 'CLEAR', description: 'Clear sky' },
  1: { condition: 'CLEAR', description: 'Mainly clear' },
  2: { condition: 'PARTLY_CLOUDY', description: 'Partly cloudy' },
  3: { condition: 'CLOUDY', description: 'Overcast' },
  45: { condition: 'FOG', description: 'Fog' },
  48: { condition: 'FOG', description: 'Freezing fog' },
  51: { condition: 'RAIN', description: 'Light drizzle' },
  53: { condition: 'RAIN', description: 'Drizzle' },
  55: { condition: 'RAIN', description: 'Dense drizzle' },
  56: { condition: 'SLEET', description: 'Light freezing drizzle' },
  57: { condition: 'SLEET', description: 'Freezing drizzle' },
  61: { condition: 'RAIN', description: 'Light rain' },
  63: { condition: 'RAIN', description: 'Rain' },
  65: { condition: 'HEAVY_RAIN', description: 'Heavy rain' },
  66: { condition: 'SLEET', description: 'Light freezing rain' },
  67: { condition: 'SLEET', description: 'Freezing rain' },
  71: { condition: 'SNOW', description: 'Light snow' },
  73: { condition: 'SNOW', description: 'Snow' },
  75: { condition: 'SNOW', description: 'Heavy snow' },
  77: { condition: 'SNOW', description: 'Snow grains' },
  80: { condition: 'RAIN', description: 'Light showers' },
  81: { condition: 'RAIN', description: 'Showers' },
  82: { condition: 'HEAVY_RAIN', description: 'Violent showers' },
  85: { condition: 'SNOW', description: 'Snow showers' },
  86: { condition: 'SNOW', description: 'Heavy snow showers' },
  95: { condition: 'THUNDERSTORM', description: 'Thunderstorm' },
  96: { condition: 'THUNDERSTORM', description: 'Thunderstorm with hail' },
  99: { condition: 'THUNDERSTORM', description: 'Severe thunderstorm with hail' },
};

export function normalizeWmoCode(
  code: number | null | undefined,
): { condition: WeatherCondition; description: string } | null {
  if (code === null || code === undefined || !Number.isFinite(code)) return null;
  return WMO[Math.round(code)] ?? null;
}
