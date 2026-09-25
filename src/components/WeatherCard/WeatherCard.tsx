import { memo } from 'react';
import type { RouteWeatherPoint } from '../../types/weather';
import { formatRelative } from '../../utils/time';
import { formatUtcOffset } from '../../utils/timezone';
import {
  CONDITION_LABEL,
  confidenceLabel,
  formatTemp,
  notableWind,
  placeLabel,
  pointAriaLabel,
  precipChance,
} from '../../ui/weatherText';
import { DropIcon, WindIcon } from '../Icons/Icons';
import { WeatherIcon } from '../WeatherIcon/WeatherIcon';
import './WeatherCard.css';

interface Props {
  point: RouteWeatherPoint;
  navigating: boolean;
  selected: boolean;
  highlighted: boolean;
  updated: boolean;
  /** Timezone of the start, to flag cards in a different timezone. */
  originTimeZone: string;
  /** Reserve the second time line (local clock while driving / other timezone). */
  showSub: boolean;
  onSelect(id: string): void;
}

/**
 * One stop on the journey: when you'll get there, where, and the weather
 * forecast for that moment.
 */
export const WeatherCard = memo(function WeatherCard({
  point,
  navigating,
  selected,
  highlighted,
  updated,
  originTimeZone,
  showSub,
  onSelect,
}: Props) {
  const w = point.weather;
  const isCurrent = point.status === 'current';
  const chance = precipChance(w);
  const wind = notableWind(w);
  const conf = confidenceLabel(point);
  const otherTz = point.timezone !== originTimeZone ? formatUtcOffset(point.arrivalMs, point.timezone) : null;

  const primary = isCurrent ? 'Now' : navigating ? formatRelative(point.estimatedTravelMinutes * 60) : point.localTime;
  const timeLabel = isCurrent
    ? 'now'
    : navigating
      ? `in ${formatRelative(point.estimatedTravelMinutes * 60).replace('+', '')}, at ${point.localTime}`
      : `estimated arrival ${point.localTime}`;

  const cls = [
    'wcard',
    w && !w.isDay ? 'is-night' : '',
    selected ? 'is-selected' : '',
    highlighted && !selected ? 'is-highlighted' : '',
    isCurrent ? 'is-current' : '',
    updated ? 'is-updated' : '',
    point.confidence === 'low' ? 'is-uncertain' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={cls}
      data-point-id={point.id}
      aria-pressed={selected}
      aria-label={pointAriaLabel(point, timeLabel)}
      onClick={() => onSelect(point.id)}
    >
      <span className="wcard__time tabular">
        {!isCurrent && !navigating ? (
          <span className="wcard__eta">{point.distanceFromStartKm === 0 ? 'LEAVE' : 'ETA'}</span>
        ) : null}
        {primary}
      </span>
      {showSub ? (
        <span className="wcard__sub tabular">
          {navigating && !isCurrent ? point.localTime : (otherTz ?? '\u00a0')}
        </span>
      ) : null}
      <span className="wcard__place" title={placeLabel(point)}>
        {placeLabel(point)}
      </span>
      {w ? (
        <>
          <WeatherIcon condition={w.condition} isDay={w.isDay} size={38} className="wcard__icon" />
          <span className="wcard__temp tabular">
            {point.confidence === 'low' ? '~' : ''}
            {formatTemp(w.temperature)}
          </span>
          <span className="wcard__cond">{CONDITION_LABEL[w.condition]}</span>
          <span className="wcard__extra tabular">
            {chance !== null ? (
              <span className="wcard__precip">
                <DropIcon size={12} />
                {chance}%
              </span>
            ) : wind !== null ? (
              <span className="wcard__wind">
                <WindIcon size={12} />
                {wind}
              </span>
            ) : (
              ' '
            )}
          </span>
        </>
      ) : (
        <span className="wcard__na">No forecast</span>
      )}
      {conf ? <span className="wcard__conf">{conf}</span> : null}
    </button>
  );
});
