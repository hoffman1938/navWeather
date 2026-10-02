import { formatDistance, formatDuration } from '../../i18n/format';
import type { ExposureKind, RouteOptionSummary } from '../../state/derive';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { RoadForecast } from './RoadForecast';

/**
 * Roads to choose from, each with what matters: time, distance, the roads it
 * follows and ITS OWN forecast (weather at the time you'd be there). The
 * weather comparison is a suggestion — never auto-selected.
 */
export function RouteOptions() {
  const m = useMessages();
  const units = useSettings((s) => s.units.distance);
  const options = useAppStore((s) => s.derived.options);
  const selected = useAppStore((s) => s.selectedOption);
  if (options.length < 2) return null;
  const fastest = options.reduce((a, b) => (b.durationS < a.durationS ? b : a));
  const wettest = options.reduce((a, b) => (b.heavyMinutes + b.wetMinutes > a.heavyMinutes + a.wetMinutes ? b : a));
  // "Route B is 20 min longer, with less heavy rain expected" — only when it's real.
  let better: { o: RouteOptionSummary; kind: ExposureKind } | null = null;
  for (const o of options) {
    if (o.index === fastest.index || !o.hasWeather || !fastest.hasWeather || o.durationS - fastest.durationS > 45 * 60) continue;
    for (const kind of SIGNIFICANT) {
      if (fastest.exposure[kind] - o.exposure[kind] >= 15 && (!better || SIGNIFICANT.indexOf(kind) < SIGNIFICANT.indexOf(better.kind))) better = { o, kind };
    }
  }
  const names = roadNames(options, m);

  return (
    <section className="ropts" aria-label={m.ui.routes}>
      <ul className="rows" role="radiogroup" aria-label={m.ui.routes}>
        {options.map((o) => {
          const delta = o.durationS - fastest.durationS;
          const exposure = o.hasWeather ? exposureLine(o, m) : '';
          const name = names.get(o.index) ?? '';
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
                  <span className="ropt__head">
                    <span className="ropt__name">{name}</span>
                    {o.via.length ? <span className="ropt__via">{m.ui.via(o.via.join(' · '))}</span> : null}
                  </span>
                  <span className="ropt__meta tabular">
                    {formatDuration(o.durationS, m)} · {formatDistance(o.distanceM, units, m)}
                    {delta > 60 ? ` · ${m.ui.longer(formatDuration(delta, m))}` : ''}
                  </span>
                  {o.forecast ? <RoadForecast forecast={o.forecast} label={`${m.ui.roadForecast}: ${name}`} /> : null}
                  <span className={`ropt__wx${o === wettest && o.wetMinutes >= 10 ? ' is-wet' : ''}`}>{exposure}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {better ? (
        <p className="ropts__hint">{m.ui.lessWeather(names.get(better.o.index) ?? '', formatDuration(better.o.durationS - fastest.durationS, m), m.ui.exposure[better.kind])}</p>
      ) : null}
    </section>
  );
}

/** Most significant first. Rain alone is listed only when nothing worse is expected. */
const SIGNIFICANT: ExposureKind[] = ['storm', 'snow', 'heavy', 'fog', 'wind'];

/**
 * "Fastest", then "Alternative 1", "Alternative 2"… in the order the roads
 * come (a faster-than-first alternative must not leave the first one as
 * "Alternative 0").
 */
export function roadNames(options: { index: number; durationS: number }[], m: ReturnType<typeof useMessages>): Map<number, string> {
  const names = new Map<number, string>();
  if (options.length === 0) return names;
  const fastest = options.reduce((a, b) => (b.durationS < a.durationS ? b : a));
  let n = 0;
  for (const o of options) names.set(o.index, o.index === fastest.index ? m.ui.fastest : `${m.ui.alternative} ${++n}`);
  return names;
}

/** "Heavy rain 35 min · Fog 10 min", or the familiar rain/dry line (also used on the map). */
export function exposureLine(o: RouteOptionSummary, m: ReturnType<typeof useMessages>, max = 2): string {
  const top = SIGNIFICANT.filter((k) => o.exposure[k] >= 5)
    .sort((a, b) => o.exposure[b] - o.exposure[a])
    .slice(0, max)
    .map((k) => `${m.ui.exposure[k]} ${formatDuration(o.exposure[k] * 60, m)}`);
  if (top.length) return top.join(' · ');
  return o.wetMinutes >= 10 ? m.ui.wetterBy(o.wetMinutes) : m.ui.mostlyDry;
}
