import { useRef, useState, type ReactNode } from 'react';
import type { SheetState } from '../../state/store';
import { useLayoutStore } from '../../state/layout';
import { useElementSize } from '../../hooks/useElementSize';
import { useMessages } from '../../state/settings';
import './BottomSheet.css';

const ORDER: SheetState[] = ['compact', 'default', 'expanded'];

interface Props {
  state: SheetState;
  onChange(s: SheetState): void;
  header: ReactNode;
  body?: ReactNode;
  extra?: ReactNode;
  label: string;
  grabber?: boolean;
}

/**
 * Bottom sheet with three detents (side panel on landscape phones and wide
 * screens keep the bottom layout). Drag the grabber/header, or tap the
 * grabber to cycle compact → default → expanded → compact.
 */
export function BottomSheet({ state, onChange, header, body, extra, label, grabber = true }: Props) {
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; id: number; active: boolean } | null>(null);
  const [dy, setDy] = useState(0);
  const setInsets = useLayoutStore((s) => s.setInsets);
  const m = useMessages();

  useElementSize(ref, (r) => {
    // Docked at the side (landscape phones): the map loses width, not height.
    const side = r.top < 80 && r.width < window.innerWidth * 0.6;
    setInsets(side ? { bottom: 0, left: Math.round(r.right) } : { bottom: Math.round(window.innerHeight - r.top), left: 0 });
  });

  const step = (dir: 1 | -1) => {
    const i = ORDER.indexOf(state);
    const next = ORDER[Math.max(0, Math.min(ORDER.length - 1, i + dir))];
    if (next !== state) onChange(next);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!grabber) return;
    const t = e.target as HTMLElement;
    if (t.closest('button:not(.sheet__handle), input, a, select, [role="dialog"], [role="menu"]')) return;
    drag.current = { y: e.clientY, id: e.pointerId, active: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dyNow = e.clientY - d.y;
    if (!d.active) {
      if (Math.abs(dyNow) < 6) return;
      d.active = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    // Follow the finger (resisted when pulling up past the detent).
    setDy(dyNow < 0 ? Math.max(-40, dyNow / 3) : Math.min(160, dyNow));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.active) return;
    const moved = e.clientY - d.y;
    setDy(0);
    if (moved < -36) step(1);
    else if (moved > 36) step(-1);
  };

  const nextState: SheetState = state === 'expanded' ? 'compact' : state === 'compact' ? 'default' : 'expanded';

  return (
    <section
      ref={ref}
      className={`sheet sheet--${state}${dy ? ' is-dragging' : ''}`}
      style={dy ? { transform: `translateY(${dy}px)` } : undefined}
      aria-label={label}
    >
      <div className="sheet__grab" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        {grabber ? (
          <button
            className="sheet__handle"
            aria-label={
              ORDER.indexOf(nextState) > ORDER.indexOf(state) ? m.ui.sheetMore : nextState === 'compact' ? m.ui.sheetMinimize : m.ui.sheetLess
            }
            aria-expanded={state === 'expanded'}
            onClick={() => onChange(nextState)}
          >
            <span className="sheet__grabber" />
          </button>
        ) : (
          <div className="sheet__spacer" />
        )}
        <div className="sheet__header">{header}</div>
      </div>
      <div className="sheet__scroll">
        {state !== 'compact' && body ? <div className="sheet__body">{body}</div> : null}
        {state === 'expanded' && extra ? <div className="sheet__extra">{extra}</div> : null}
      </div>
    </section>
  );
}
