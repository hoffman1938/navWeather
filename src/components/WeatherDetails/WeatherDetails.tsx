import type { RouteWeatherPoint } from '../../types/weather';
import { formatDuration } from '../../utils/time';
import { formatLocalDate, formatUtcOffset } from '../../utils/timezone';
import { compassDir, conditionLabel, formatTemp, placeLabel } from '../../ui/weatherText';
import { CloseIcon } from '../Icons/Icons';
import { WeatherIcon } from '../WeatherIcon/WeatherIcon';
import './WeatherDetails.css';

interface Props {
  point: RouteWeatherPoint;
  navigating: boolean;
  onClose(): void;
}

/** Everything about one route point — shown only after tapping a card. */
export function WeatherDetails({ point, navigating, onClose }: Props) {
  const w = point.weather;
  const isCurrent = point.status === 'current';
  const rows: [string, string][] = [];
  if (w) {
    if (w.feelsLike !== undefined) rows.push(['Feels like', formatTemp(w.feelsLike)]);
    if (w.precipitationProbability !== undefined)
      rows.push(['Chance of precipitation', `${Math.round(w.precipitationProbability / 5) * 5}%`]);
    if (w.precipitation !== undefined && w.precipitation > 0)
      rows.push(['Precipitation (that hour)', `${w.precipitation} mm`]);
    if (w.snowfall !== undefined && w.snowfall > 0) rows.push(['Snowfall (that hour)', `${w.snowfall} cm`]);
    if (w.windSpeed !== undefined)
      rows.push([
        'Wind',
        `${w.windSpeed} km/h ${compassDir(w.windDirection)}${w.windGusts ? ` · gusts ${w.windGusts}` : ''}`,
      ]);
    if (w.visibility !== undefined)
      rows.push(['Visibility', w.visibility >= 10000 ? '10+ km' : w.visibility >= 1000 ? `${(w.visibility / 1000).toFixed(1)} km` : `${w.visibility} m`]);
    if (w.cloudCover !== undefined) rows.push(['Cloud cover', `${w.cloudCover}%`]);
    if (w.humidity !== undefined) rows.push(['Humidity', `${w.humidity}%`]);
  }
  if (point.elevationM !== undefined) rows.push(['Elevation', `${point.elevationM} m`]);
  rows.push(['Distance from start', `${Math.round(point.distanceFromStartKm)} km`]);

  const when = isCurrent
    ? `Now · ${point.localTime}`
    : `${navigating ? `In ${formatDuration(point.estimatedTravelMinutes * 60)} · ` : ''}Estimated arrival ${point.localTime}`;

  return (
    <section className="details" aria-labelledby={`details-${point.id}`}>
      <div className="details__head">
        {w ? <WeatherIcon condition={w.condition} isDay={w.isDay} size={52} /> : null}
        <div className="details__title">
          <h3 id={`details-${point.id}`}>{placeLabel(point)}</h3>
          <p className="details__when tabular">{when}</p>
          <p className="details__tz">
            {formatLocalDate(point.arrivalMs, point.timezone)} · local time {formatUtcOffset(point.arrivalMs, point.timezone)}
          </p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close details">
          <CloseIcon size={18} />
        </button>
      </div>
      {w ? (
        <p className="details__summary">
          <span className="details__temp tabular">{formatTemp(w.temperature)}</span>
          <span>{w.description ?? conditionLabel(w)}</span>
        </p>
      ) : (
        <p className="details__summary">Forecast not available for this time.</p>
      )}
      <dl className="details__grid">
        {rows.map(([k, v]) => (
          <div key={k} className="details__row">
            <dt>{k}</dt>
            <dd className="tabular">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="details__note">
        {isCurrent
          ? 'Forecast for your current position right now.'
          : `This is the forecast for when you're expected to arrive here — not the weather there right now.${
              point.confidence !== 'high'
                ? ` It's ${Math.round(point.forecastLeadHours)} hours ahead, so treat it as a rough guide.`
                : ''
            }`}
      </p>
    </section>
  );
}
