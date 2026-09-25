import { useCallback, useEffect, useRef } from 'react';
import type { TimelineItem } from '../../algorithms/timeline';
import { useReducedMotion } from '../../hooks/useMediaQuery';
import { useAppStore } from '../../state/store';
import { SunriseIcon } from '../Icons/Icons';
import { WeatherCard } from '../WeatherCard/WeatherCard';
import './WeatherTimeline.css';

const EMPTY: string[] = [];

/**
 * Horizontal, Apple-Weather-style journey timeline. Synchronized with the
 * map: tapping a card selects it (map flies there); a marker tap scrolls the
 * matching card into view; scrolling highlights the centred card's point.
 */
export function WeatherTimeline() {
  const items = useAppStore((s) => s.derived.timelineItems);
  const navigating = useAppStore((s) => s.mode !== 'planning');
  const selectedId = useAppStore((s) => s.selectedPointId);
  const selectionSource = useAppStore((s) => s.selectionSource);
  const highlightedId = useAppStore((s) => s.highlightedPointId);
  const originTz = useAppStore((s) => s.derived.points[0]?.timezone ?? 'UTC');
  const updatedIds = useAppStore((s) =>
    s.lastRefresh && Date.now() - s.lastRefresh.atMs < 4000 ? s.lastRefresh.changedIds : EMPTY,
  );
  // Second time line only when it carries information.
  const showSub = navigating || items.some((i) => i.type === 'point' && i.point.timezone !== originTz);
  const reduced = useReducedMotion();
  const scroller = useRef<HTMLDivElement>(null);
  const programmatic = useRef(false);
  const raf = useRef(0);

  const onSelect = useCallback((id: string) => {
    const s = useAppStore.getState();
    s.select(s.selectedPointId === id ? null : id, 'timeline');
  }, []);

  // Map → timeline: bring the selected card into view.
  useEffect(() => {
    if (!selectedId || selectionSource !== 'map') return;
    const el = scroller.current?.querySelector<HTMLElement>(`[data-point-id="${CSS.escape(selectedId)}"]`);
    if (!el || !scroller.current) return;
    programmatic.current = true;
    const box = scroller.current;
    const left = el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2;
    box.scrollTo({ left, behavior: reduced ? 'auto' : 'smooth' });
    const t = window.setTimeout(() => (programmatic.current = false), 600);
    return () => window.clearTimeout(t);
  }, [selectedId, selectionSource, reduced]);

  // Timeline scroll → subtle map highlight of the centred card.
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

  return (
    <div className="timeline" ref={scroller} onScroll={onScroll} role="list" aria-label="Weather along your route">
      {items.map((item) => (
        <div role="listitem" key={item.id} className="timeline__item">
          {item.type === 'point' ? (
            <WeatherCard
              point={item.point}
              navigating={navigating}
              selected={selectedId === item.id}
              highlighted={highlightedId === item.id}
              updated={updatedIds.includes(item.id)}
              originTimeZone={originTz}
              showSub={showSub}
              onSelect={onSelect}
            />
          ) : (
            <SunMarker item={item} />
          )}
        </div>
      ))}
    </div>
  );
}

function SunMarker({ item }: { item: Extract<TimelineItem, { type: 'sun' }> }) {
  return (
    <div className={`sunmark sunmark--${item.kind}`} aria-label={`${item.kind === 'sunset' ? 'Sunset' : 'Sunrise'} around ${item.localTime}`}>
      <span className="sunmark__time tabular">{item.localTime}</span>
      <SunriseIcon size={22} className="sunmark__icon" />
      <span className="sunmark__label">{item.kind === 'sunset' ? 'Sunset' : 'Sunrise'}</span>
    </div>
  );
}
