import { useEffect, useRef, useState } from 'react';
import { useMessages } from '../../state/settings';
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
import { ChevronIcon } from '../Icons/Icons';

/** Departure time, entered in the START location's timezone (never assumed to be the device's). */
export function DepartureSelector() {
  const m = useMessages();
  const departure = useAppStore((s) => s.departure);
  const originTz = useAppStore((s) => s.derived.points[0]?.timezone ?? deviceTimeZone());
  const originName = useAppStore((s) => s.plan?.timed.route.origin.name ?? '');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const firstOption = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    firstOption.current?.focus();
    const onDoc = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const now = Date.now();
  const when =
    departure.mode === 'now'
      ? m.ui.leaveNow
      : m.ui.leaveAt(
          `${localDateKey(departure.utcMs, originTz) === localDateKey(now, originTz) ? '' : `${formatLocalDate(departure.utcMs, originTz)} `}${formatLocalTime(departure.utcMs, originTz)}`,
        );
  const tomorrow8 = (() => {
    const p = zonedParts(now + 86400000, originTz);
    return zonedWallTimeToUtc({ year: p.year, month: p.month, day: p.day, hour: 8, minute: 0 }, originTz);
  })();
  const round5 = (ms: number) => Math.ceil(ms / 300_000) * 300_000;
  const presets: { label: string; value: Departure }[] = [
    { label: m.ui.presetNow, value: { mode: 'now' } },
    { label: m.ui.presetIn1h, value: { mode: 'at', utcMs: round5(now + 3600_000) } },
    { label: m.ui.presetIn3h, value: { mode: 'at', utcMs: round5(now + 3 * 3600_000) } },
    { label: m.ui.presetTomorrow, value: { mode: 'at', utcMs: tomorrow8 } },
  ];
  const choose = (d: Departure) => {
    useAppStore.getState().setDeparture(d);
    setOpen(false);
  };

  return (
    <div className="departure" ref={ref}>
      <button className="linkbtn tabular" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {when}
        <ChevronIcon size={14} />
      </button>
      {open ? (
        <div className="popover departure__pop" role="dialog" aria-label={m.ui.departure}>
          <ul className="rows">
            {presets.map((p, i) => (
              <li key={p.label}>
                <button ref={i === 0 ? firstOption : undefined} className="popover__row" onClick={() => choose(p.value)}>
                  {p.label}
                </button>
              </li>
            ))}
          </ul>
          <label className="departure__custom">
            <span>{m.ui.customTime(originName, formatUtcOffset(now, originTz))}</span>
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
          <p className="departure__hint">{m.ui.horizonHint}</p>
        </div>
      ) : null}
    </div>
  );
}
