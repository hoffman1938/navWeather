import { useEffect, useRef, useState } from 'react';
import { useAppStore, type Departure } from '../../state/store';
import {
  deviceTimeZone,
  formatLocalDate,
  formatLocalTime,
  formatUtcOffset,
  localDateKey,
  parseDateTimeLocal,
  toDateTimeLocalValue,
  zonedParts,
  zonedWallTimeToUtc,
} from '../../utils/timezone';
import { ChevronIcon, ClockIcon } from '../Icons/Icons';

/**
 * "Leave now ▾" — pick a departure. Times are entered and shown in the
 * START location's timezone (never assumed to be the device timezone).
 */
export function DepartureSelector() {
  const departure = useAppStore((s) => s.departure);
  const originTz = useAppStore((s) => s.derived.points[0]?.timezone ?? deviceTimeZone());
  const originName = useAppStore((s) => s.plan?.timed.route.origin.name ?? 'Start');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const now = Date.now();
  const label =
    departure.mode === 'now'
      ? 'Leave now'
      : `Leave ${localDateKey(departure.utcMs, originTz) === localDateKey(now, originTz) ? '' : `${formatLocalDate(departure.utcMs, originTz)} `}${formatLocalTime(departure.utcMs, originTz)}`;

  const tomorrowAt8 = (() => {
    const p = zonedParts(now + 86400000, originTz);
    return zonedWallTimeToUtc({ year: p.year, month: p.month, day: p.day, hour: 8, minute: 0 }, originTz);
  })();
  const presets: { label: string; value: Departure }[] = [
    { label: 'Now', value: { mode: 'now' } },
    { label: 'In 1 hour', value: { mode: 'at', utcMs: roundTo5(now + 3600_000) } },
    { label: 'In 3 hours', value: { mode: 'at', utcMs: roundTo5(now + 3 * 3600_000) } },
    { label: 'Tomorrow 08:00', value: { mode: 'at', utcMs: tomorrowAt8 } },
  ];
  const choose = (d: Departure) => {
    useAppStore.getState().setDeparture(d);
    setOpen(false);
  };

  return (
    <div className="departure" ref={ref}>
      <button className="chip" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ClockIcon size={16} />
        <span className="tabular">{label}</span>
        <ChevronIcon size={14} />
      </button>
      {open ? (
        <div className="departure__pop" role="dialog" aria-label="Departure time">
          <div className="departure__presets">
            {presets.map((p) => (
              <button key={p.label} className="chip" onClick={() => choose(p.value)}>
                {p.label}
              </button>
            ))}
          </div>
          <label className="departure__custom">
            <span>
              Custom · {originName} time ({formatUtcOffset(now, originTz)})
            </span>
            <input
              type="datetime-local"
              min={toDateTimeLocalValue(now - 3600_000, originTz)}
              max={toDateTimeLocalValue(now + 14 * 86400000, originTz)}
              defaultValue={toDateTimeLocalValue(departure.mode === 'at' ? departure.utcMs : now, originTz)}
              onChange={(e) => {
                const utc = parseDateTimeLocal(e.target.value, originTz);
                if (utc !== null) useAppStore.getState().setDeparture({ mode: 'at', utcMs: utc });
              }}
            />
          </label>
          <p className="departure__hint">Forecasts reach about 2 weeks ahead and get less certain further out.</p>
        </div>
      ) : null}
    </div>
  );
}

function roundTo5(ms: number): number {
  return Math.ceil(ms / 300_000) * 300_000;
}
