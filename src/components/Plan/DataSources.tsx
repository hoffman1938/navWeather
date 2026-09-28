import { formatAgo } from '../../i18n/format';
import { getProviders } from '../../services/providers';
import { useMessages } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { deviceTimeZone, formatLocalTime } from '../../utils/timezone';

type Status = 'forecast' | 'estimated' | 'stale' | 'unavailable' | 'simulated' | 'community';

/**
 * What each piece of information is based on — forecast, estimate, stale,
 * simulated, or not available — so nothing looks more "live" than it is.
 */
export function DataSources() {
  const m = useMessages();
  const D = m.data;
  const weatherUpdatedAt = useAppStore((s) => s.weatherUpdatedAt);
  const stale = useAppStore((s) => s.weatherStale);
  const online = useAppStore((s) => s.online);
  const simulated = useAppStore((s) => s.simulatedData);
  const driving = useAppStore((s) => s.mode !== 'planning');
  const speedLoaded = useAppStore((s) => s.speedLimits !== null);
  const p = getProviders();
  const old = weatherUpdatedAt !== null && Date.now() - weatherUpdatedAt > 60 * 60_000;
  const weatherStatus: Status = simulated ? 'simulated' : stale || !online || old ? 'stale' : weatherUpdatedAt ? 'forecast' : 'unavailable';
  const rows: [string, Status, string][] = [
    [
      D.weather,
      weatherStatus,
      weatherUpdatedAt
        ? `Open-Meteo · ${weatherStatus === 'stale' ? formatAgo(weatherUpdatedAt, Date.now(), m) : D.updated(formatLocalTime(weatherUpdatedAt, deviceTimeZone()))}`
        : '',
    ],
    [D.eta, 'estimated', D.etaDetail],
    [D.traffic, p.traffic.name === 'none' ? 'unavailable' : 'forecast', p.traffic.name === 'none' ? D.noProvider : p.traffic.name],
    [D.incidents, p.incidents.name === 'none' ? 'unavailable' : 'forecast', p.incidents.name === 'none' ? D.noProvider : p.incidents.name],
    [D.speed, p.speedLimits ? 'community' : 'unavailable', p.speedLimits ? (speedLoaded || !driving ? D.osm : D.loading) : D.noProvider],
  ];
  return (
    <section className="datasrc">
      <h3 className="label">{D.title}</h3>
      <ul className="rows">
        {rows.map(([name, status, detail]) => (
          <li key={name}>
            <span className="datasrc__name">{name}</span>
            <span className="datasrc__value">
              <span className={`datasrc__status datasrc__status--${status}`}>{D.status[status]}</span>
              {detail ? <span className="datasrc__detail"> · {detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
