import { formatDistance, formatDuration } from '../../i18n/format';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';

/**
 * Route choices with what matters: time, distance and weather exposure.
 * The weather comparison is a suggestion — never auto-selected.
 */
export function RouteOptions() {
  const m = useMessages();
  const units = useSettings((s) => s.units.distance);
  const options = useAppStore((s) => s.derived.options);
  const selected = useAppStore((s) => s.selectedOption);
  if (options.length < 2) return null;
  const fastest = options.reduce((a, b) => (b.durationS < a.durationS ? b : a));
  const wettest = options.reduce((a, b) => (b.heavyMinutes + b.wetMinutes > a.heavyMinutes + a.wetMinutes ? b : a));
  // "Route B is 20 min longer but avoids the heaviest rain" — only when it's real.
  const drier = options
    .filter((o) => o.index !== fastest.index && o.hasWeather && fastest.hasWeather)
    .find((o) => fastest.heavyMinutes - o.heavyMinutes >= 15 && o.durationS - fastest.durationS <= 45 * 60);
  const name = (i: number) => (i === fastest.index ? m.ui.fastest : `${m.ui.alternative} ${i}`);

  return (
    <section className="ropts" aria-label={m.ui.routes}>
      <ul className="rows" role="radiogroup" aria-label={m.ui.routes}>
        {options.map((o) => {
          const delta = o.durationS - fastest.durationS;
          const exposure = o.hasWeather ? (o.wetMinutes >= 10 ? m.ui.wetterBy(o.wetMinutes) : m.ui.mostlyDry) : '';
          return (
            <li key={o.index}>
              <button
                role="radio"
                aria-checked={o.index === selected}
                className={`ropt${o.index === selected ? ' is-selected' : ''}`}
                onClick={() => void useAppStore.getState().selectRouteOption(o.index)}
              >
                <span className="ropt__mark" aria-hidden="true" />
                <span className="ropt__main">
                  <span className="ropt__name">{name(o.index)}</span>
                  <span className="ropt__meta tabular">
                    {formatDuration(o.durationS, m)} · {formatDistance(o.distanceM, units, m)}
                    {delta > 60 ? ` · ${m.ui.longer(formatDuration(delta, m))}` : ''}
                  </span>
                </span>
                <span className={`ropt__wx${o === wettest && o.wetMinutes >= 10 ? ' is-wet' : ''}`}>{exposure}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {drier ? <p className="ropts__hint">{m.ui.avoidsRain(name(drier.index), formatDuration(drier.durationS - fastest.durationS, m))}</p> : null}
    </section>
  );
}
