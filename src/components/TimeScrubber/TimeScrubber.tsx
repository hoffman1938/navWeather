import { useId } from 'react';
import { formatDistance, formatDuration, formatTemp } from '../../i18n/format';
import { selectScrub } from '../../state/scrub';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { deviceTimeZone, formatLocalTime } from '../../utils/timezone';
import { WeatherIcon } from '../WeatherIcon/WeatherIcon';
import './TimeScrubber.css';

const MIN = 60_000;

/** "Where will I be at 10:30 — and what weather is expected there then?" */
export function TimeScrubber() {
  const id = useId();
  const m = useMessages();
  const units = useSettings((s) => s.units);
  const hasPlan = useAppStore((s) => s.plan !== null);
  const startMs = useAppStore((s) =>
    s.mode !== 'planning' && s.progress ? Math.ceil(s.progress.nowMs / MIN) * MIN : s.derived.departureMs,
  );
  const endMs = useAppStore((s) => (s.derived.arrivalMs ? Math.floor(s.derived.arrivalMs / MIN) * MIN : null));
  const scrubMs = useAppStore((s) => s.scrubMs);
  const state = useAppStore(selectScrub);
  const tz = useAppStore((s) => s.derived.points[0]?.timezone ?? deviceTimeZone());

  if (!hasPlan || endMs === null || endMs <= startMs) return null;
  const step = endMs - startMs > 6 * 3600_000 ? 15 * MIN : 5 * MIN;
  const lo = Math.ceil(startMs / step) * step;
  const hi = Math.max(lo, Math.floor(endMs / step) * step);
  const value = scrubMs === null ? lo : Math.min(hi, Math.max(lo, scrubMs));
  const w = state?.weather ?? null;
  const where = state
    ? state.arrived
      ? m.ui.youllHaveArrived(state.placeName ?? '')
      : state.placeName
        ? m.ui.youllBeAt(state.placeName)
        : m.ui.youllBeKm(formatDistance(state.distanceM, units.distance, m))
    : '';

  return (
    <section className="scrub" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="label">
        {m.ui.whereWillIBe}
      </h3>
      <div className="scrub__row">
        <span className="scrub__time tabular" aria-hidden="true">
          {state ? state.localTime : formatLocalTime(value, tz)}
        </span>
        <input
          className="scrub__range"
          type="range"
          min={lo}
          max={hi}
          step={step}
          value={value}
          aria-label={m.ui.whereWillIBe}
          aria-valuetext={state ? `${state.localTime}, ${where}` : formatLocalTime(value, tz)}
          onChange={(e) => useAppStore.getState().setScrub(Number(e.target.value))}
        />
      </div>
      {state ? (
        <div className="scrub__answer" aria-live="polite">
          {w ? <WeatherIcon condition={w.condition} isDay={w.isDay} size={36} /> : null}
          <p>
            <strong>{where}</strong>
            <span className="scrub__meta tabular">
              {m.ui.intoDrive(formatDuration(state.travelTimeS, m), formatDistance(state.distanceM, units.distance, m))}
            </span>
            <span className="scrub__wx">
              {w
                ? `${m.ui.forecastThen}: ${m.weather.condition[w.condition]} · ${formatTemp(w.temperature, units.temperature)}${
                    w.precipitationProbability && w.precipitationProbability >= 15 ? ` · ${Math.round(w.precipitationProbability / 5) * 5}%` : ''
                  }`
                : m.ui.noForecastThen}
            </span>
          </p>
        </div>
      ) : (
        <p className="scrub__hint">{m.ui.whereHint}</p>
      )}
    </section>
  );
}
