import { memo, useCallback, useEffect, useRef } from 'react';
import type { TimelineItem } from '../../algorithms/timeline';
import { formatDurationCompact, formatTemp, formatSpeed } from '../../i18n/format';
import type { Messages } from '../../i18n/en';
import { useReducedMotion } from '../../hooks/useMediaQuery';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import type { RouteWeatherPoint } from '../../types/weather';
import { formatUtcOffset } from '../../utils/timezone';
import { WeatherIcon } from '../WeatherIcon/WeatherIcon';
import './WeatherStrip.css';

const EMPTY: string[] = [];

/**
 * The journey as one continuous hourly-style strip: when you'll be where,
 * and the forecast for that moment. Synchronized with the map: tap a column
 * → map flies there; tap a marker → strip scrolls; scrolling highlights the
 * centred point on the map.
 */
export function WeatherStrip() {
  const items = useAppStore((s) => s.derived.timelineItems);
  const navigating = useAppStore((s) => s.mode !== 'planning');
  const selectedId = useAppStore((s) => s.selectedPointId);
  const selectionSource = useAppStore((s) => s.selectionSource);
  const highlightedId = useAppStore((s) => s.highlightedPointId);
  const originTz = useAppStore((s) => s.derived.points[0]?.timezone ?? 'UTC');
  const updatedIds = useAppStore((s) =>
    s.lastRefresh && Date.now() - s.lastRefresh.atMs < 4000 ? s.lastRefresh.changedIds : EMPTY,
  );
  const m = useMessages();
  const reduced = useReducedMotion();
  const scroller = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);
  const raf = useRef(0);

  const onSelect = useCallback((id: string) => {
    const s = useAppStore.getState();
    s.select(s.selectedPointId === id ? null : id, 'timeline');
  }, []);

  useEffect(() => {
    if (!selectedId || selectionSource !== 'map') return;
    const box = scroller.current;
    const el = box?.querySelector<HTMLElement>(`[data-point-id="${CSS.escape(selectedId)}"]`);
    if (!el || !box) return;
    programmatic.current = true;
    box.scrollTo({ left: el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2, behavior: reduced ? 'auto' : 'smooth' });
    const t = window.setTimeout(() => (programmatic.current = false), 600);
    return () => window.clearTimeout(t);
  }, [selectedId, selectionSource, reduced]);

  const onScroll = () => {
    if (programmatic.current) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const box = scroller.current;
      if (!box) return;
      const center = box.scrollLeft + box.clientWidth / 2;
      let best: string | null = null;
      let bestD = Infinity;
      box.querySelectorAll<HTMLElement>('[data-point-id]').forEach((el) => {
        const d = Math.abs(el.offsetLeft + el.clientWidth / 2 - center);
        if (d < bestD) {
          bestD = d;
          best = el.dataset.pointId ?? null;
        }
      });
      if (best) useAppStore.getState().highlight(best);
    });
  };

  if (items.length === 0) return null;
  const showSub = navigating || items.some((i) => i.type === 'point' && i.point.timezone !== originTz);

  return (
    <section className="wstrip" aria-label={m.ui.weatherAlongRoute}>
      <p className="wstrip__caption">{m.ui.etaNote}</p>
      <div className="wstrip__scroll" ref={scroller} onScroll={onScroll} role="list">
        {items.map((item) =>
          item.type === 'point' ? (
            <div role="listitem" key={item.id} className="wstrip__item">
              <Column
                point={item.point}
                navigating={navigating}
                selected={selectedId === item.id}
                highlighted={highlightedId === item.id}
                updated={updatedIds.includes(item.id)}
                originTz={originTz}
                showSub={showSub}
                onSelect={onSelect}
              />
            </div>
          ) : (
            <div role="listitem" key={item.id} className="wstrip__item">
              <SunTick item={item} m={m} />
            </div>
          ),
        )}
      </div>
    </section>
  );
}

interface ColumnProps {
  point: RouteWeatherPoint;
  navigating: boolean;
  selected: boolean;
  highlighted: boolean;
  updated: boolean;
  originTz: string;
  showSub: boolean;
  onSelect(id: string): void;
}

const Column = memo(function Column({ point, navigating, selected, highlighted, updated, originTz, showSub, onSelect }: ColumnProps) {
  const m = useMessages();
  const units = useSettings((s) => s.units);
  const w = point.weather;
  const isCurrent = point.status === 'current';
  const chance = w?.precipitationProbability !== undefined && w.precipitationProbability >= 15 ? Math.round(w.precipitationProbability / 5) * 5 : null;
  const gust = w && ((w.windGusts ?? 0) >= 45 || (w.windSpeed ?? 0) >= 30) ? Math.max(w.windGusts ?? 0, w.windSpeed ?? 0) : null;
  const place = point.placeName ? (point.placeRelation === 'near' ? m.ui.near(point.placeName) : point.placeName) : m.ui.km(String(Math.round(point.distanceFromStartKm)));
  const primary = isCurrent
    ? m.time.now
    : navigating
      ? `+${formatDurationCompact(point.estimatedTravelMinutes * 60, m)}`
      : point.localTime;
  const otherTz = point.timezone !== originTz ? formatUtcOffset(point.arrivalMs, point.timezone) : null;
  const conf = point.confidence === 'medium' ? m.ui.lessCertainTag : point.confidence === 'low' ? m.ui.lowConfidenceTag : null;
  const label = [
    place,
    isCurrent ? m.time.now : `${m.ui.eta} ${point.localTime}`,
    w ? m.weather.condition[w.condition] : m.ui.noForecast,
    w ? formatTemp(w.temperature, units.temperature) : null,
    chance !== null ? `${chance}%` : null,
    conf,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <button
      type="button"
      className={[
        'wcol',
        w && !w.isDay ? 'is-night' : '',
        selected ? 'is-selected' : '',
        highlighted && !selected ? 'is-highlighted' : '',
        isCurrent ? 'is-current' : '',
        updated ? 'is-updated' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-point-id={point.id}
      aria-pressed={selected}
      aria-label={label}
      onClick={() => onSelect(point.id)}
    >
      {!isCurrent && !navigating ? (
        <span className="wcol__eta">{point.distanceFromStartKm === 0 ? m.ui.leave : m.ui.eta}</span>
      ) : null}
      <span className="wcol__time tabular">{primary}</span>
      {showSub ? <span className="wcol__sub tabular">{navigating && !isCurrent ? point.localTime : (otherTz ?? ' ')}</span> : null}
      <span className="wcol__place">{place}</span>
      {w ? (
        <>
          <WeatherIcon condition={w.condition} isDay={w.isDay} size={34} className="wcol__icon" />
          <span className="wcol__temp tabular">
            {point.confidence === 'low' ? '~' : ''}
            {formatTemp(w.temperature, units.temperature)}
          </span>
          <span className="wcol__cond">{m.weather.condition[w.condition]}</span>
          <span className="wcol__extra tabular">
            {chance !== null ? (
              <span className="wcol__precip">{chance}%</span>
            ) : gust !== null ? (
              <span className="wcol__wind">{formatSpeed(gust, units.wind, m)}</span>
            ) : (
              ' '
            )}
          </span>
        </>
      ) : (
        <span className="wcol__na">{m.ui.noForecast}</span>
      )}
      {conf ? <span className="wcol__conf">{conf}</span> : null}
    </button>
  );
});

function SunTick({ item, m }: { item: Extract<TimelineItem, { type: 'sun' }>; m: Messages }) {
  const label = item.kind === 'sunset' ? m.ui.sunset : m.ui.sunrise;
  return (
    <div className={`wsun wsun--${item.kind}`} aria-label={`${label} ${item.localTime}`}>
      <span className="wsun__time tabular">{item.localTime}</span>
      <span className="wsun__line" aria-hidden="true" />
      <span className="wsun__label">{label}</span>
    </div>
  );
}
