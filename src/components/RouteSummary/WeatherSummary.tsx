import { useEffect, useState } from 'react';
import { useAppStore } from '../../state/store';
import { formatAgo } from '../../utils/time';
import { deviceTimeZone, formatLocalTime } from '../../utils/timezone';
import { config } from '../../config';
import { RefreshIcon } from '../Icons/Icons';
import { WeatherIcon } from '../WeatherIcon/WeatherIcon';

/** Headline ("Rain likely near Khashuri") + freshness + manual refresh. */
export function WeatherSummary() {
  const summary = useAppStore((s) => s.derived.summary);
  const status = useAppStore((s) => s.weatherStatus);
  const error = useAppStore((s) => s.weatherError);
  const stale = useAppStore((s) => s.weatherStale);
  const updatedAt = useAppStore((s) => s.weatherUpdatedAt);
  const navigating = useAppStore((s) => s.mode !== 'planning');
  const lastLeadHours = useAppStore((s) => s.derived.points.at(-1)?.forecastLeadHours ?? 0);
  const [, force] = useState(0);

  // Keep "Updated N min ago" honest without re-rendering the whole sheet.
  useEffect(() => {
    const t = window.setInterval(() => force((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const loading = status === 'loading';
  const ageMs = updatedAt ? Date.now() - updatedAt : 0;
  const old = updatedAt !== null && ageMs > config.weather.cacheTtlMinutes * 60000;
  const updatedText = updatedAt
    ? old || stale
      ? `Updated ${formatAgo(updatedAt, Date.now())}`
      : `Updated ${formatLocalTime(updatedAt, deviceTimeZone())}`
    : '';

  const lead = summary?.highlights[0];
  const noData = !summary || summary.tone === 'unknown';

  return (
    <section className="wsum" aria-live="polite">
      <div className="wsum__row">
        {lead && !noData ? (
          <WeatherIcon condition={toneIcon(summary!.tone, lead.condition)} isDay={lead.isDay} size={36} className="wsum__icon" />
        ) : null}
        <div className="wsum__text">
          <p className="wsum__eyebrow">{navigating ? 'Weather ahead' : 'Weather along your route'}</p>
          {noData ? (
            <h3 className="wsum__headline">
              {loading ? 'Loading route weather…' : (error ?? 'Weather data temporarily unavailable')}
            </h3>
          ) : (
            <h3 className="wsum__headline">{summary!.headline}</h3>
          )}
          {!noData && summary?.detail ? (
            <p className="wsum__detail">
              {summary.detail}
              {lastLeadHours > 12 ? ' · forecasts further ahead are less certain' : ''}
              {updatedText ? <span className="wsum__updated-inline tabular"> · {updatedText}</span> : null}
            </p>
          ) : null}
        </div>
        {summary && summary.highlights.length > 1 ? (
          <ul className="wsum__highlights" aria-label="Weather by stretch">
            {summary.highlights.map((h) => (
              <li key={h.text} className="wsum__hl">
                <WeatherIcon condition={h.condition} isDay={h.isDay} size={20} />
                {h.text}
              </li>
            ))}
          </ul>
        ) : null}
        <button
          className="wsum__refresh"
          onClick={() => void useAppStore.getState().loadWeather({ force: true, reason: 'manual' })}
          disabled={loading}
          aria-label={`Update weather. ${updatedText}`}
        >
          {loading ? <span className="spinner" aria-hidden="true" /> : <RefreshIcon size={16} />}
          <span className="wsum__updated tabular">{loading ? 'Updating…' : updatedText || 'Update'}</span>
        </button>
      </div>
      {error && !noData ? (
        <p className="wsum__warning" role="status">
          {error}
          {updatedAt ? ` · showing forecast from ${formatAgo(updatedAt, Date.now())}` : ''}
        </p>
      ) : null}
    </section>
  );
}

function toneIcon(tone: string, fallback: import('../../types/weather').WeatherCondition) {
  if (tone === 'wet') return 'RAIN';
  if (tone === 'severe') return 'THUNDERSTORM';
  if (tone === 'wintry') return 'SNOW';
  return fallback;
}
