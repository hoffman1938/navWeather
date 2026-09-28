import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { formatDistance } from '../../i18n/format';
import { instructionText } from '../../navigation/instructions';
import { LaneArrow, ManeuverIcon } from '../Common/ManeuverIcon';

/** Beyond this, the banner says "continue on …" and shows the turn as "then". */
const FAR_M = 20_000;

/** NEXT TURN — the one thing a driver needs most. Real lane data only. */
export function ManeuverBanner() {
  const guidance = useAppStore((s) => s.guidance);
  const recalculating = useAppStore((s) => s.recalculating);
  const offline = useAppStore((s) => !s.online);
  const units = useSettings((s) => s.units.distance);
  const m = useMessages();
  const next = guidance?.next;
  if (!next) return null;
  const d = guidance.distanceToNextM;
  // Round like a sign: 50 m steps nearby, 0.1 km further out.
  const rounded = d < 1000 ? Math.max(0, Math.round(d / 50) * 50) : d;
  const turnText = instructionText(next, m);
  // A long stretch ahead: say "continue on the road" and show the turn as "then" (as in other nav apps).
  const far = d > FAR_M;
  const road = guidance.currentRoadRef || guidance.currentRoadName;
  const instruction = far ? m.ui.continueOn(road) : turnText;
  const close = d < 300;
  const validLanes = next.lanes?.filter((l) => l.valid).length ?? 0;

  return (
    <section className={`mbanner${close ? ' is-close' : ''}`} aria-label={instruction}>
      <div className="mbanner__main">
        <span className="mbanner__icon">
          {far ? (
            <ManeuverIcon kind="continue" modifier="straight" size={48} />
          ) : (
            <ManeuverIcon kind={next.kind} modifier={next.modifier} exit={next.exit} size={close ? 56 : 48} />
          )}
        </span>
        <div className="mbanner__text">
          <p className="mbanner__dist tabular">{formatDistance(rounded, units, m)}</p>
          <p className="mbanner__instr">{instruction}</p>
        </div>
      </div>
      {!far && next.lanes && next.lanes.length > 1 && validLanes > 0 && validLanes < next.lanes.length ? (
        <div className="mbanner__lanes" role="img" aria-label={`${validLanes} / ${next.lanes.length}`}>
          {next.lanes.map((l, i) => (
            <LaneArrow key={i} indications={l.indications} active={l.valid} />
          ))}
        </div>
      ) : null}
      {far ? (
        <p className="mbanner__then mbanner__then--far">
          {m.ui.then}
          <ManeuverIcon kind={next.kind} modifier={next.modifier} exit={next.exit} size={22} />
          <span className="mbanner__thenText">{turnText}</span>
        </p>
      ) : guidance.then ? (
        <p className="mbanner__then">
          {m.ui.then}
          <ManeuverIcon kind={guidance.then.kind} modifier={guidance.then.modifier} size={22} />
        </p>
      ) : null}
      {recalculating || offline ? (
        <p className="mbanner__status" role="status">
          {recalculating ? m.ui.recalculating : m.ui.offline}
        </p>
      ) : null}
      {/* Announce instruction changes to screen readers, not every distance tick. */}
      <span className="sr-only" aria-live="polite">
        {instruction}
      </span>
    </section>
  );
}
