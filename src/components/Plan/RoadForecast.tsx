import type { RoadForecast as Forecast } from '../../algorithms/roadForecast';
import { formatTemp } from '../../i18n/format';
import { useMessages, useSettings } from '../../state/settings';
import { WeatherIcon } from '../WeatherIcon/WeatherIcon';
import './RoadForecast.css';

/**
 * The forecast along one road at a glance: the whole road as a coloured
 * ribbon (clear → storm) and a few stops with the time you'd be there, the
 * expected weather and temperature. Colour is never the only cue: every stop
 * has an icon and a number.
 */
export function RoadForecast({ forecast, label }: { forecast: Forecast; label?: string }) {
  const m = useMessages();
  const unit = useSettings((s) => s.units.temperature);
  const range =
    forecast.minTemperature !== undefined && forecast.maxTemperature !== undefined
      ? forecast.minTemperature === forecast.maxTemperature
        ? formatTemp(forecast.maxTemperature, unit)
        : `${formatTemp(forecast.minTemperature, unit)}–${formatTemp(forecast.maxTemperature, unit)}`
      : '';
  return (
    <span className="rfc" role="group" aria-label={label ?? m.ui.roadForecast}>
      <span className="rfc__ribbon" role="img" aria-label={range ? `${forecast.headline}, ${range}` : forecast.headline}>
        {forecast.ribbon.map((s, i) => (
          <span key={i} className="rfc__seg" data-wx={s.groupClass} style={{ flexGrow: Math.max(0.001, s.to - s.from) }} />
        ))}
      </span>
      <span className="rfc__stops">
        {forecast.stops.map((s) => (
          <span key={s.id} className="rfc__stop">
            <span className="rfc__where">{s.placeName ?? m.ui.km(String(Math.round(s.distanceKm)))}</span>
            <span className="rfc__now tabular">
              <WeatherIcon condition={s.condition} isDay={s.isDay} size={22} />
              {formatTemp(s.temperature, unit)}
            </span>
            <span className="rfc__time tabular">{s.localTime}</span>
          </span>
        ))}
      </span>
    </span>
  );
}
