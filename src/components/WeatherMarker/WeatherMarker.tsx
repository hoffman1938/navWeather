import { memo } from 'react';
import type { RouteWeatherPoint } from '../../types/weather';
import { conditionLabel, formatTemp, placeLabel } from '../../ui/weatherText';
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
  const w = point.weather;
  if (!w) return null;
  const time = navigating ? `+${Math.max(0, point.estimatedTravelMinutes)} min` : point.localTime;
  return (
    <button
      type="button"
      className={`wmarker${selected ? ' is-selected' : ''}${highlighted && !selected ? ' is-highlighted' : ''}${w.isDay ? '' : ' is-night'}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(point.id);
      }}
      aria-label={`${placeLabel(point)}, ${conditionLabel(w)}, ${Math.round(w.temperature)} degrees, estimated arrival ${point.localTime}`}
      aria-pressed={selected}
    >
      <span className="wmarker__pill">
        <WeatherIcon condition={w.condition} isDay={w.isDay} size={22} />
        <span className="wmarker__temp tabular">{formatTemp(w.temperature)}</span>
        {selected ? (
          <span className="wmarker__place">
            {placeLabel(point)} · <span className="tabular">{time}</span>
          </span>
        ) : null}
      </span>
      <span className="wmarker__stem" aria-hidden="true" />
    </button>
  );
});
