import { useMemo } from 'react';
import { planDepartures, type DeparturePlan } from '../../algorithms/departurePlanner';
import { formatDuration } from '../../i18n/format';
import { getProviders } from '../../services/providers';
import { forecastLookupFn } from '../../services/routePlanner';
import { useMessages } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { deviceTimeZone, formatLocalTime } from '../../utils/timezone';

const SLOT = 30 * 60_000;

/** The departure comparison for the current route (recomputed per 30-min slot). */
function useDeparturePlan(): { plan: DeparturePlan | null; tz: string } {
  const route = useAppStore((s) => s.plan);
  const forecasts = useAppStore((s) => s.forecasts);
  const departure = useAppStore((s) => s.departure);
  const slot = useAppStore((s) => Math.floor(s.clockMs / SLOT));
  const tz = useAppStore((s) => s.derived.points[0]?.timezone ?? deviceTimeZone());
  const plan = useMemo(() => {
    if (!route || forecasts.size === 0) return null;
    const now = slot * SLOT;
    const chosen = departure.mode === 'at' ? departure.utcMs : Date.now();
    return planDepartures(route.samples, route.timed.totalTimeS, forecastLookupFn(getProviders(), forecasts), chosen, now);
  }, [route, forecasts, departure, slot]);
  return { plan, tz };
}

function lessText(p: DeparturePlan, m: ReturnType<typeof useMessages>): string | null {
  const s = p.suggestion;
  if (!s) return null;
  const severe = p.current.severeMinutes - s.severeMinutes;
  const wet = p.current.wetMinutes - s.wetMinutes;
  if (severe >= 10) return m.depart.lessSevere(formatDuration(severe * 60, m));
  if (wet >= 10) return m.depart.lessRain(formatDuration(wet * 60, m));
  return null;
}

/** One line under the weather headline — only when another time is clearly better. */
export function DepartureTip() {
  const m = useMessages();
  const { plan, tz } = useDeparturePlan();
  const mode = useAppStore((s) => s.mode);
  if (!plan?.suggestion || mode !== 'planning') return null;
  const less = lessText(plan, m);
  if (!less) return null;
  const time = formatLocalTime(plan.suggestion.departMs, tz);
  const at = plan.suggestion.departMs;
  return (
    <p className="depart-tip">
      <span>{m.depart.suggest(time, less)}</span>
      <button className="linkbtn" onClick={() => useAppStore.getState().setDeparture({ mode: 'at', utcMs: at })}>
        {m.depart.use(time)}
      </button>
    </p>
  );
}

/** Next 12 hours of departures as bars: how much of the drive is in rain / severe weather. */
export function DepartureChart() {
  const m = useMessages();
  const { plan, tz } = useDeparturePlan();
  const totalMin = useAppStore((s) => (s.plan ? s.plan.timed.totalTimeS / 60 : 1));
  if (!plan) return null;
  const scores = plan.options.map((o) => o.score);
  const varies = Math.max(...scores) - Math.min(...scores) >= 10;
  const pct = (min: number) => Math.min(100, (min / Math.max(1, totalMin)) * 100);
  const mid = plan.options[Math.floor(plan.options.length / 2)];
  const last = plan.options[plan.options.length - 1];
  return (
    <section className="depart">
      <h3 className="label">{m.depart.title}</h3>
      {!varies ? (
        <p className="depart__note">{m.depart.similar}</p>
      ) : (
        <>
          {plan.current === plan.best ? <p className="depart__note">{m.depart.currentBest}</p> : null}
          <div className="depart__chart" role="group" aria-label={m.depart.title}>
            {plan.options.map((o) => {
              const time = formatLocalTime(o.departMs, tz);
              const selected = o === plan.current;
              return (
                <button
                  key={o.departMs}
                  className={`depart__bar${selected ? ' is-current' : ''}${o === plan.best ? ' is-best' : ''}`}
                  aria-label={`${m.depart.bar(time, formatDuration(o.wetMinutes * 60, m))}${selected ? ` (${m.depart.selected})` : ''}`}
                  aria-pressed={selected}
                  onClick={() => useAppStore.getState().setDeparture({ mode: 'at', utcMs: o.departMs })}
                >
                  <span className="depart__wet" style={{ height: `${Math.max(3, pct(o.wetMinutes))}%` }}>
                    <span className="depart__severe" style={{ height: `${o.wetMinutes ? (o.severeMinutes / o.wetMinutes) * 100 : 0}%` }} />
                  </span>
                </button>
              );
            })}
          </div>
          <div className="depart__axis tabular" aria-hidden="true">
            <span>{formatLocalTime(plan.options[0].departMs, tz)}</span>
            <span>{formatLocalTime(mid.departMs, tz)}</span>
            <span>{formatLocalTime(last.departMs, tz)}</span>
          </div>
          <p className="depart__legend">
            <span className="depart__key depart__key--wet" aria-hidden="true" /> {m.depart.legendRain}
            <span className="depart__key depart__key--severe" aria-hidden="true" /> {m.depart.legendSevere}
          </p>
        </>
      )}
    </section>
  );
}
