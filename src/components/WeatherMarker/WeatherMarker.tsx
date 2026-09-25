import { memo } from 'react';
import type { RouteWeatherPoint } from '../../types/weather';
import { formatTemp } from '../../i18n/format';
import { useMessages, useSettings } from '../../state/settings';
import { WeatherIcon } from '../WeatherIcon/WeatherIcon';
import './WeatherMarker.css';

interface Props {
  point: RouteWeatherPoint;
  selected: boolean;
  highlighted: boolean;
  navigating: boolean;
  onSelect(id: string): void;
}

/** Subtle map pill: icon + temperature. Place & time appear when selected. */
export const WeatherMarker = memo(function WeatherMarker({ point, selected, highlighted, navigating, onSelect }: Props) {
  const m = useMessages();
  const unit = useSettings((s) => s.units.temperature);
  const w = point.weather;
  if (!w) return null;
  const place = point.placeName ? (point.placeRelation === 'near' ? m.ui.near(point.placeName) : point.placeName) : m.ui.km(String(Math.round(point.distanceFromStartKm)));
  const time = navigating ? `+${Math.max(0, point.estimatedTravelMinutes)} ${m.units.min}` : point.localTime;
  return (
    <button
      type="button"
      className={`wmarker${selected ? ' is-selected' : ''}${highlighted && !selected ? ' is-highlighted' : ''}${w.isDay ? '' : ' is-night'}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(point.id);
      }}
      aria-label={`${place}, ${m.weather.condition[w.condition]}, ${formatTemp(w.temperature, unit)}, ${m.ui.eta} ${point.localTime}`}
      aria-pressed={selected}
    >
      <span className="wmarker__pill">
        <WeatherIcon condition={w.condition} isDay={w.isDay} size={22} />
        <span className="wmarker__temp tabular">{formatTemp(w.temperature, unit)}</span>
        {selected ? (
          <span className="wmarker__place">
            {place} · <span className="tabular">{time}</span>
          </span>
        ) : null}
      </span>
      <span className="wmarker__stem" aria-hidden="true" />
    </button>
  );
});
