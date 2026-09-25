import { memo } from 'react';
import { formatDistance, formatDuration } from '../../i18n/format';
import type { RouteEvent } from '../../intelligence/types';
import { instructionText } from '../../navigation/instructions';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { EventIcon } from '../Common/EventIcon';
import { ManeuverIcon } from '../Common/ManeuverIcon';

/**
 * "What's ahead?" — next turn, weather changes, stops and the destination,
 * in the order you'll reach them. Rows, not cards.
 */
export function AheadList() {
  const ahead = useAppStore((s) => s.derived.intelligence.ahead);
  const guidance = useAppStore((s) => s.guidance);
  const m = useMessages();
  const units = useSettings((s) => s.units.distance);
  return (
    <section className="ahead" aria-label={m.ui.ahead}>
      <h3 className="label ahead__label">{m.ui.ahead}</h3>
      <ol className="rows">
        {guidance?.next && guidance.next.kind !== 'arrive' ? (
          <li className="ahead__row">
            <span className="ahead__when tabular">{formatDistance(guidance.distanceToNextM, units, m)}</span>
            <span className="ahead__icon">
              <ManeuverIcon kind={guidance.next.kind} modifier={guidance.next.modifier} size={26} />
            </span>
            <span className="ahead__what">{instructionText(guidance.next, m)}</span>
          </li>
        ) : null}
        {ahead.map((e) => (
          <AheadRow key={e.id} e={e} />
        ))}
      </ol>
    </section>
  );
}

const AheadRow = memo(function AheadRow({ e }: { e: RouteEvent }) {
  const m = useMessages();
  const units = useSettings((s) => s.units.distance);
  const severity =
    e.severity === 'critical' || e.severity === 'high' ? ` sev-${e.severity}` : '';
  return (
    <li className={`ahead__row${severity}`}>
      <span className="ahead__when tabular">{formatDuration(e.estimatedMinutesFromCurrent * 60, m)}</span>
      <span className="ahead__icon">
        <EventIcon icon={e.icon} isDay={e.isDay} size={26} />
      </span>
      <span className="ahead__what">
        <span className="ahead__title">{e.title}</span>
        {e.shortMessage ? <span className="ahead__detail">{e.shortMessage}</span> : null}
      </span>
      <span className="ahead__dist tabular">{formatDistance(e.distanceFromCurrentM, units, m)}</span>
    </li>
  );
});
