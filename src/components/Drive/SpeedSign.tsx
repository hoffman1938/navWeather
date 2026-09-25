import { speedLimitAt } from '../../algorithms/speedLimits';
import { speedValue } from '../../i18n/format';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';

/**
 * Posted limit (from OSM, when known) + current speed (live GPS only).
 * Never encourages speeding; the note says signs take precedence.
 */
export function SpeedSign() {
  const m = useMessages();
  const units = useSettings((s) => s.units.distance);
  const enabled = useSettings((s) => s.speedWarnings);
  const limit = useAppStore((s) => (s.progress ? speedLimitAt(s.speedLimits, s.progress.distanceAlongM) : null));
  const speedKmh = useAppStore((s) =>
    s.mode === 'navigating' && s.vehicle?.speedMps !== undefined ? Math.round(s.vehicle.speedMps * 3.6) : null,
  );
  const speeding = useAppStore((s) => s.speeding.speeding);
  if (!enabled || (limit === null && speedKmh === null)) return null;
  const unit = units === 'imperial' ? m.units.mph : m.units.kmh;
  return (
    <div className={`speed${speeding ? ' is-over' : ''}`} title={m.ui.speedLimitNote}>
      {limit !== null ? (
        <span className="speed__sign tabular" aria-label={`${m.ui.speedLimit} ${speedValue(limit, units)} ${unit}`}>
          {speedValue(limit, units)}
        </span>
      ) : null}
      {speedKmh !== null ? (
        <span className="speed__now tabular" aria-label={`${m.ui.yourSpeed} ${speedValue(speedKmh, units)} ${unit}`}>
          {speedValue(speedKmh, units)}
          <small>{unit}</small>
        </span>
      ) : null}
      {speeding ? <span className="sr-only" role="status">{m.ui.speedLimit}</span> : null}
    </div>
  );
}
