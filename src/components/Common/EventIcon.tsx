import type { EventIcon as IconKey } from '../../intelligence/types';
import { WeatherIcon } from '../WeatherIcon/WeatherIcon';

const WEATHER: Partial<Record<IconKey, Parameters<typeof WeatherIcon>[0]['condition']>> = {
  rain: 'RAIN',
  'heavy-rain': 'HEAVY_RAIN',
  snow: 'SNOW',
  storm: 'THUNDERSTORM',
  fog: 'FOG',
  ice: 'SLEET',
  clear: 'CLEAR',
};

const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

/** Icon for a route event: weather glyphs for weather, simple line icons otherwise. */
export function EventIcon({ icon, isDay = true, size = 24 }: { icon: IconKey; isDay?: boolean; size?: number }) {
  const wx = WEATHER[icon];
  if (wx) return <WeatherIcon condition={wx} isDay={isDay} size={size} />;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      {icon === 'wind' && <path {...s} d="M3 8h11a3 3 0 1 0-3-3M3 16h14a3 3 0 1 1-3 3M3 12h17" />}
      {icon === 'cold' && <path {...s} d="M12 3v18M5 7l14 10M19 7L5 17" />}
      {icon === 'speed' && <circle {...s} cx="12" cy="12" r="8" strokeWidth={3} />}
      {icon === 'fuel' && <path {...s} d="M5 20V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v15M4 20h11M14 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3M7 8h5" />}
      {icon === 'charging' && <path {...s} d="M13 3L5 14h6l-1 7 8-11h-6l1-7z" />}
      {icon === 'flag' && <path {...s} d="M6 21V4M6 4h11l-2.5 4L17 12H6" />}
      {icon === 'stop' && <path {...s} d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z" />}
      {icon === 'poi' && <circle {...s} cx="12" cy="11" r="4" />}
      {(icon === 'incident' || icon === 'traffic') && <path {...s} d="M12 3l9.5 17h-19L12 3zM12 10v4M12 17h.01" />}
    </svg>
  );
}
