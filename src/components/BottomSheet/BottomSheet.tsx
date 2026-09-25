import { useRef, useState, type ReactNode } from 'react';
import type { SheetState } from '../../state/store';
import { useLayoutStore } from '../../state/layout';
import { useElementSize } from '../../hooks/useElementSize';
import './BottomSheet.css';

const ORDER: SheetState[] = ['compact', 'default', 'expanded'];

interface Props {
  state: SheetState;
  onChange(s: SheetState): void;
  header: ReactNode;
  body?: ReactNode;
  extra?: ReactNode;
  label: string;
}

/**
 * Bottom sheet with three snap states. Drag the grabber/header or tap the
 * grabber to cycle. The map stays visible above; the sheet reports its
 * height so the map can keep the route in view.
 */
export function BottomSheet({ state, onChange, header, body, extra, label }: Props) {
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; id: number; active: boolean } | null>(null);
  const [dy, setDy] = useState(0);
  const setInsets = useLayoutStore((s) => s.setInsets);

  useElementSize(ref, (r) => setInsets({ bottom: Math.round(window.innerHeight - r.top) }));

  const step = (dir: 1 | -1) => {
    const i = ORDER.indexOf(state);
    const next = ORDER[Math.max(0, Math.min(ORDER.length - 1, i + dir))];
    if (next !== state) onChange(next);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('button:not(.sheet__handle), input, a, select, [role="dialog"]')) return;
    // Don't capture yet: a plain tap must still reach the handle button.
    drag.current = { y: e.clientY, id: e.pointerId, active: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y;
    if (!d.active) {
      if (Math.abs(dy) < 6) return;
      d.active = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    setDy(Math.max(-120, Math.min(160, dy)));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.active) return;
    const dy = e.clientY - d.y;
    setDy(0);
    if (dy < -36) step(1);
    else if (dy > 36) step(-1);
  };

  return (
    <section
      ref={ref}
      className={`sheet sheet--${state}${dy ? ' is-dragging' : ''}`}
      style={dy ? { transform: `translateY(${Math.max(0, dy)}px)` } : undefined}
      aria-label={label}
    >
      <div
        className="sheet__grab"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <button
          className="sheet__handle"
          aria-label={state === 'expanded' ? 'Show less' : 'Show more'}
          aria-expanded={state === 'expanded'}
          onClick={() => onChange(state === 'expanded' ? 'default' : state === 'compact' ? 'default' : 'expanded')}
        >
          <span className="sheet__grabber" />
        </button>
        <div className="sheet__header">{header}</div>
      </div>
      <div className="sheet__scroll">
        {state !== 'compact' && body ? <div className="sheet__body">{body}</div> : null}
        {state === 'expanded' && extra ? <div className="sheet__extra">{extra}</div> : null}
      </div>
    </section>
  );
}
