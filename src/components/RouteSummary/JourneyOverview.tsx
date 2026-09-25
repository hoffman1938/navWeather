import { useAppStore } from '../../state/store';
import { formatLocalTime } from '../../utils/timezone';
import { AlertIcon } from '../Icons/Icons';
import { WeatherIcon } from '../WeatherIcon/WeatherIcon';

/** Expanded view: weather by stretch + notable events ("heads-up"). */
export function JourneyOverview() {
  const groups = useAppStore((s) => s.derived.groups);
  const events = useAppStore((s) => s.derived.events);
  const points = useAppStore((s) => s.derived.points);
  const tz = points[0]?.timezone ?? 'UTC';
  const notable = events.filter((e) => e.severity !== 'info' || e.type === 'temperature-drop');

  if (groups.length === 0) return null;
  return (
    <div className="journey">
      {notable.length ? (
        <section>
          <h4 className="journey__h">Heads-up</h4>
          <ul className="journey__events">
            {notable.slice(0, 6).map((e) => (
              <li key={e.id} className={`journey__event journey__event--${e.severity}`}>
                <AlertIcon size={16} />
                <span>{e.message}</span>
                <span className="journey__time tabular">~{formatLocalTime(e.arrivalMs, tz)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section>
        <h4 className="journey__h">Along the way</h4>
        <ol className="journey__groups">
          {groups.map((g) => (
            <li key={g.id} className="journey__group">
              <WeatherIcon condition={g.condition} size={26} />
              <span className="journey__gtext">
                <span className="journey__glabel">{g.label}</span>
                <span className="journey__gplace">
                  {g.fromName ?? `km ${Math.round(g.startDistanceM / 1000)}`}
                  {g.toName && g.toName !== g.fromName ? ` → ${g.toName}` : ''}
                </span>
              </span>
              <span className="journey__gtemp tabular">
                {Math.round(g.minTemperature ?? 0) === Math.round(g.maxTemperature ?? 0)
                  ? `${Math.round(g.maxTemperature ?? 0)}°`
                  : `${Math.round(g.minTemperature ?? 0)}–${Math.round(g.maxTemperature ?? 0)}°`}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
