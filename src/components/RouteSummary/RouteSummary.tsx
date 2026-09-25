import { useAppStore } from '../../state/store';
import { formatDistance, formatDuration } from '../../utils/time';
import { deviceTimeZone, formatLocalTime } from '../../utils/timezone';
import { NavigateIcon, PlayIcon } from '../Icons/Icons';
import { DepartureSelector } from './DepartureSelector';
import './RouteSummary.css';

/** "Tbilisi → Batumi · 358 km · 4h 53m" + departure + primary actions. */
export function RouteSummary() {
  const plan = useAppStore((s) => s.plan);
  const arrivalMs = useAppStore((s) => s.derived.arrivalMs);
  const destTz = useAppStore((s) => s.derived.points.at(-1)?.timezone ?? deviceTimeZone());
  if (!plan) return null;
  const { route } = plan.timed;

  return (
    <div className="rsum">
      <div className="rsum__top">
        <h2 className="rsum__title">
          {route.origin.name} <span aria-label="to">→</span> {route.destination.name}
        </h2>
        <p className="rsum__meta tabular">
          {formatDistance(plan.timed.totalDistM)} · ~{formatDuration(plan.timed.totalTimeS)}
          {arrivalMs ? <> · Arrive {formatLocalTime(arrivalMs, destTz)}</> : null}
        </p>
        <DepartureSelector />
      </div>
      <div className="rsum__actions">
        <button className="btn btn-secondary" onClick={() => useAppStore.getState().startSimulation()}>
          <PlayIcon size={16} />
          Simulate drive
        </button>
        <button className="btn btn-primary" onClick={() => useAppStore.getState().startNavigation()}>
          <NavigateIcon size={16} />
          Start
        </button>
      </div>
    </div>
  );
}
