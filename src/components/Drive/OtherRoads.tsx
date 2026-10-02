import { formatDistance, formatDuration } from '../../i18n/format';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { RoadForecast } from '../Plan/RoadForecast';
import { exposureLine } from '../Plan/RouteOptions';

/**
 * While driving: the other roads to the destination the car can still take
 * from here — each with the time it would take, how that differs from the
 * road being driven, and its own forecast for the times you'd be there.
 * Never switched automatically; the driver picks one (or just takes it — the
 * app notices that too).
 */
export function OtherRoads() {
  const m = useMessages();
  const units = useSettings((s) => s.units.distance);
  const roads = useAppStore((s) => s.derived.otherRoads);
  if (roads.length === 0) return null;
  return (
    <section aria-label={m.ui.otherRoads}>
      <h3 className="label">{m.ui.otherRoads}</h3>
      <ul className="rows">
        {roads.map((r) => {
          const name = r.via.length ? m.ui.via(r.via.join(' · ')) : m.ui.alternative;
          const minutes = Math.round(r.deltaS / 60);
          const delta = minutes > 0 ? m.ui.longer(formatDuration(minutes * 60, m)) : minutes < 0 ? m.ui.shorter(formatDuration(-minutes * 60, m)) : m.ui.same;
          const exposure = r.hasWeather ? exposureLine(r, m) : '';
          return (
            <li key={r.index} className="oroad">
              <div className="oroad__head">
                <span className="oroad__text">
                  <span className="oroad__name">{name}</span>
                  <span className="oroad__meta tabular">
                    {formatDuration(r.durationS, m)} · {formatDistance(r.distanceM, units, m)} · <span className="oroad__delta">{delta}</span>
                  </span>
                </span>
                <button className="btn btn-quiet" onClick={() => useAppStore.getState().switchToRoad(r.index)}>
                  {m.ui.takeThisRoad}
                </button>
              </div>
              {r.forecast ? <RoadForecast forecast={r.forecast} label={`${m.ui.roadForecast}: ${name}`} /> : null}
              {exposure ? <span className="oroad__wx">{exposure}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
