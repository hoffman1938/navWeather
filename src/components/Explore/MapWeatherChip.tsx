import { useEffect, useState } from 'react';
import { matchForecastToTime } from '../../algorithms/weatherMatching';
import { formatTemp } from '../../i18n/format';
import { aqiLevel } from '../../services/air/AirQualityProvider';
import { getProviders } from '../../services/providers';
import { useExplore } from '../../state/explore';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import type { WeatherAtTime } from '../../types/weather';
import { WeatherIcon } from '../WeatherIcon/WeatherIcon';

/**
 * Weather and air quality at the middle of the map while exploring (as map
 * apps show in a corner). Tap it for the full forecast there. One cached
 * request per ~5 km cell, only at city-level zoom and after the map settles.
 */
export function MapWeatherChip() {
  const m = useMessages();
  const temp = useSettings((s) => s.units.temperature);
  const view = useExplore((s) => s.view);
  const hasCard = useExplore((s) => s.card !== null);
  const idle = useAppStore((s) => s.mode === 'planning' && s.plan === null && s.routeStatus !== 'geocoding' && s.routeStatus !== 'routing');
  const [data, setData] = useState<{ key: string; w: WeatherAtTime; aqi: number | null } | null>(null);

  const key = view && view.zoom >= 8 ? `${(Math.round(view.center[1] * 20) / 20).toFixed(2)},${(Math.round(view.center[0] * 20) / 20).toFixed(2)}` : null;
  useEffect(() => {
    if (!key || !view || !idle) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      const [lon, lat] = view.center;
      const svc = getProviders().weather;
      try {
        const [lookup, air] = await Promise.all([
          svc.getForecasts([{ latitude: lat, longitude: lon }], { needUntilMs: Date.now() + 3 * 3_600_000, signal: ctrl.signal }),
          getProviders().air?.current(view.center, ctrl.signal).catch(() => null) ?? Promise.resolve(null),
        ]);
        const f = lookup.forecasts.get(svc.keyFor(lat, lon));
        const w = f ? matchForecastToTime(f, Date.now()) : null;
        if (!ctrl.signal.aborted && w) setData({ key, w, aqi: air?.europeanAqi ?? null });
      } catch {
        /* chip is optional */
      }
    }, 800);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
    // view changes with every pan; the cell key decides when to refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, idle]);

  if (!idle || hasCard || !data || data.key !== key || !view) return null;
  const level = data.aqi !== null ? aqiLevel(data.aqi) : null;
  const cond = m.weather.condition[data.w.condition];
  const aria = `${m.air.here}: ${formatTemp(data.w.temperature, temp)}, ${cond}${level ? `. ${m.air.title}: ${m.air.levels[level]} (${data.aqi})` : ''}`;
  return (
    <button className="wxchip" onClick={() => useExplore.getState().dropPin(view.center)} aria-label={aria} title={aria}>
      <WeatherIcon condition={data.w.condition} isDay={data.w.isDay} size={22} />
      <span className="wxchip__temp tabular">{formatTemp(data.w.temperature, temp)}</span>
      {level ? (
        <span className="wxchip__aqi">
          <span className={`wxchip__dot aqi--${level}`} aria-hidden="true" />
          AQI {data.aqi}
        </span>
      ) : null}
    </button>
  );
}
