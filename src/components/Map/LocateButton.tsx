import { useExplore } from '../../state/explore';
import { useMessages } from '../../state/settings';
import { LocateFilledIcon, LocateIcon } from '../Icons/Icons';

/** "Show my location": first tap finds and centres you, and the map then follows until you pan. */
export function LocateButton() {
  const m = useMessages();
  const locate = useExplore((s) => s.locate);
  const follow = useExplore((s) => s.followMe);
  const cls = `fab fab--locate${locate === 'on' ? ' is-on' : ''}${locate === 'on' && follow ? ' is-follow' : ''}`;
  return (
    <button className={cls} onClick={() => useExplore.getState().locateMe()} aria-label={locate === 'pending' ? m.location.finding : m.location.show}>
      {locate === 'pending' ? <span className="spinner" aria-hidden="true" /> : locate === 'on' && follow ? <LocateFilledIcon size={22} /> : <LocateIcon size={22} />}
    </button>
  );
}
