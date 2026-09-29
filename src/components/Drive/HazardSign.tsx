import { hazardLabelKind, nextHazard, roadSurface, weatherAtDistance, type RoadHazard } from '../../algorithms/roadHazards';
import { formatDistance } from '../../i18n/format';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';

/** Shown from ~600 m (or 25 s) before a hazard until just past it. */
function signWindow(speedMps: number | undefined): number {
  return Math.max(600, (speedMps ?? 14) * 25);
}

function Glyph({ h }: { h: RoadHazard }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  const flip = h.side === 'left' ? 'translate(24 0) scale(-1 1)' : undefined;
  if (h.kind === 'level_crossing') {
    // Train front
    return (
      <g {...s} strokeWidth={2.2}>
        <rect x="7.5" y="9" width="9" height="9" rx="2" />
        <path d="M7.5 14h9M10 18l-1.5 2.5M14 18l1.5 2.5" />
      </g>
    );
  }
  const kind = hazardLabelKind(h);
  const d = kind === 'hairpin' ? 'M9 20v-6a3.5 3.5 0 0 1 7 0v1.5M13.5 13.5l2.5 2.5 2.5-2.5' : kind === 'series' ? 'M10 20c0-3 4-3 4-6s-4-3-4-6l2.5 1M10 8l-.5 2.8' : 'M10 20v-5c0-3 2-5 5-5h1M14 7.5l2.5 2.5-2.5 2.5';
  return (
    <g transform={flip}>
      <path d={d} {...s} />
    </g>
  );
}

/**
 * A warning sign for the next sharp curve or railway crossing, with the
 * distance and the forecast road surface — like the ones on the road.
 */
export function HazardSign() {
  const m = useMessages();
  const on = useSettings((s) => s.roadHazards);
  const units = useSettings((s) => s.units.distance);
  const hazard = useAppStore((s) => (s.progress ? nextHazard(s.roadHazards, s.progress.distanceAlongM, signWindow(s.vehicle?.speedMps)) : null));
  const aheadM = useAppStore((s) => (hazard && s.progress ? Math.max(0, Math.round((hazard.distanceAlongM - s.progress.distanceAlongM) / 10) * 10) : 0));
  const surface = useAppStore((s) => (hazard?.kind === 'curve' ? roadSurface(weatherAtDistance(s.derived.points, hazard.distanceAlongM)) : 'dry'));
  if (!on || !hazard) return null;
  const kind = hazard.kind === 'level_crossing' ? 'levelCrossing' : hazardLabelKind(hazard);
  const what = hazard.kind === 'curve' && kind !== 'series' ? `${m.hazard[kind]} ${m.hazard[hazard.side ?? 'right']}` : m.hazard[kind];
  const dist = formatDistance(aheadM, units, m);
  const label = [m.hazard.signLabel(what, dist), surface !== 'dry' ? m.hazard[surface] : null].filter(Boolean).join('. ');
  return (
    <div className={`hazard${surface !== 'dry' ? ` hazard--${surface}` : ''}`} role="img" aria-label={label} title={label}>
      <svg className="hazard__sign" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.2 22.6 20.6a.9.9 0 0 1-.8 1.3H2.2a.9.9 0 0 1-.8-1.3Z" className="hazard__plate" />
        <g transform="translate(12 15.2) scale(0.6) translate(-12 -14)">
          <Glyph h={hazard} />
        </g>
      </svg>
      <span className="hazard__dist tabular" aria-hidden="true">
        {dist}
      </span>
      {surface !== 'dry' ? (
        <svg className="hazard__surface" viewBox="0 0 24 24" aria-hidden="true">
          {surface === 'icy' ? (
            <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          ) : (
            <path d="M12 3s-6 6.2-6 10.5a6 6 0 0 0 12 0C18 9.2 12 3 12 3Z" fill="currentColor" />
          )}
        </svg>
      ) : null}
    </div>
  );
}
