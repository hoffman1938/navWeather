import { useId } from 'react';
import { selectScrub } from '../../state/scrub';
import { useAppStore } from '../../state/store';
import { formatDistance, formatDuration } from '../../utils/time';
import { deviceTimeZone, formatLocalTime } from '../../utils/timezone';
import { conditionLabel, formatTemp, precipChance } from '../../ui/weatherText';
import { CloseIcon, DropIcon } from '../Icons/Icons';
import { WeatherIcon } from '../WeatherIcon/WeatherIcon';
import './TimeScrubber.css';

const MIN = 60_000;

/**
 * "Where will I be at…?" — pick any time during the trip and see the
 * estimated position and the forecast for that place at that time.
 */
export function TimeScrubber() {
  const id = useId();
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
  // Snap the range to whole steps so the slider lands on round clock times (10:30, not 10:31).
  const lo = Math.ceil(startMs / step) * step;
  const hi = Math.max(lo, Math.floor(endMs / step) * step);
  const value = scrubMs === null ? lo : Math.min(hi, Math.max(lo, scrubMs));
  const w = state?.weather ?? null;
  const chance = precipChance(w);
  const where = state
    ? state.placeName
      ? `${state.placeRelation === 'in' ? 'in' : 'near'} ${state.placeName}`
      : `at km ${Math.round(state.distanceM / 1000)}`
    : '';

  return (
    <section className="scrub" aria-labelledby={`${id}-h`}>
      <div className="scrub__head">
        <h4 id={`${id}-h`} className="scrub__title">
          Where will I be at…
        </h4>
        {scrubMs !== null ? (
          <button className="icon-btn" onClick={() => useAppStore.getState().setScrub(null)} aria-label="Clear time">
            <CloseIcon size={16} />
          </button>
        ) : null}
      </div>
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
          aria-label="Time during your trip"
          aria-valuetext={state ? `${state.localTime}, ${where}` : formatLocalTime(value, tz)}
          onChange={(e) => useAppStore.getState().setScrub(Number(e.target.value))}
        />
      </div>
      {state ? (
        <div className="scrub__answer" aria-live="polite">
          {w ? <WeatherIcon condition={w.condition} isDay={w.isDay} size={40} /> : null}
          <p>
            <strong>
              {state.arrived ? `You'll have arrived ${where}` : `You'll be ${where}`}
            </strong>
            <span className="scrub__meta tabular">
              {formatDuration(state.travelTimeS)} into the drive · {formatDistance(state.distanceM)} from the start
            </span>
            {w ? (
              <span className="scrub__wx">
                Forecast then: {conditionLabel(w)} · {formatTemp(w.temperature)}
                {chance !== null ? (
                  <>
                    {' '}
                    · <DropIcon size={12} /> {chance}%
                  </>
                ) : null}
              </span>
            ) : (
              <span className="scrub__wx">No forecast for that time yet</span>
            )}
          </p>
        </div>
      ) : (
        <p className="scrub__hint">Drag to see your estimated position and the forecast there at that time.</p>
      )}
    </section>
  );
}
