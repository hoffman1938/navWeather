import { useEffect } from 'react';
import { conditionText, formatDistance, formatDuration, formatTemp } from '../../i18n/format';
import { useLayoutStore } from '../../state/layout';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { BottomSheet } from '../BottomSheet/BottomSheet';
import { WeatherIcon } from '../WeatherIcon/WeatherIcon';

/** Trip complete: what the drive was like. Shown once, kept in memory only. */
export function ArrivalSheet() {
  const m = useMessages();
  const units = useSettings((s) => s.units);
  const a = useAppStore((s) => s.arrival);
  // Nothing sits at the top of the screen on arrival (the driving banner is gone).
  useEffect(() => useLayoutStore.getState().setInsets({ top: 0 }), []);
  if (!a) return null;
  const A = m.arrival;
  const delayMin = Math.round(a.delayS / 60);
  const delay = Math.abs(delayMin) < 3 ? A.onTime : delayMin > 0 ? A.later(formatDuration(delayMin * 60, m)) : A.earlier(formatDuration(-delayMin * 60, m));
  return (
    <BottomSheet
      state="default"
      onChange={() => undefined}
      grabber={false}
      label={A.title(a.destination)}
      header={
        <div className="arrive-head">
          <h2 className="arrive-head__title">{A.title(a.destination)}</h2>
          {a.simulated ? <p className="live-tag">{A.simulated}</p> : null}
        </div>
      }
      body={
        <div className="arrive">
          <ul className="rows arrive__facts">
            <li>
              <span>{A.time}</span>
              <span className="tabular">
                {formatDuration(a.durationS, m)} · {delay}
              </span>
            </li>
            <li>
              <span>{A.distance}</span>
              <span className="tabular">{formatDistance(a.distanceM, units.distance, m)}</span>
            </li>
            {a.reroutes > 0 ? (
              <li>
                <span />
                <span>{A.reroutes(a.reroutes)}</span>
              </li>
            ) : null}
          </ul>
          <section>
            <h3 className="label">{A.weather}</h3>
            {a.conditions.length ? (
              <ul className="arrive__wx">
                {a.conditions.slice(0, 4).map((c) => (
                  <li key={c.condition}>
                    <WeatherIcon condition={c.condition} size={26} />
                    <span>{m.weather.condition[c.condition]}</span>
                    <span className="tabular arrive__min">{formatDuration(c.minutes * 60, m)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="arrive__na">{A.noWeather}</p>
            )}
            {a.minTemp !== null && a.maxTemp !== null ? (
              <p className="arrive__temps tabular">
                {Math.round(a.minTemp) === Math.round(a.maxTemp)
                  ? formatTemp(a.maxTemp, units.temperature)
                  : `${formatTemp(a.minTemp, units.temperature)}–${formatTemp(a.maxTemp, units.temperature)}`}
              </p>
            ) : null}
          </section>
          {a.arrivalWeather ? (
            <section className="arrive__now">
              <WeatherIcon condition={a.arrivalWeather.condition} isDay={a.arrivalWeather.isDay} size={36} />
              <span>
                <span className="label">{A.now}</span>
                <strong className="tabular">{formatTemp(a.arrivalWeather.temperature, units.temperature)}</strong> {conditionText(a.arrivalWeather, m)}
              </span>
            </section>
          ) : null}
          <div className="arrive__actions">
            <button className="btn btn-primary" onClick={() => useAppStore.getState().dismissArrival()}>
              {A.done}
            </button>
            <span className="arrive__note">{A.notSaved}</span>
          </div>
        </div>
      }
    />
  );
}
