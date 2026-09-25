import { useEffect } from 'react';
import { formatDistance } from '../../i18n/format';
import { useLayoutStore } from '../../state/layout';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { Dialog } from '../Common/Dialog';
import { CloseIcon } from '../Icons/Icons';
import './Notice.css';

/** Short status message; auto-dismisses unless persistent. */
export function Notice() {
  const notice = useAppStore((s) => s.notice);
  const top = useLayoutStore((s) => s.insets.top);
  const m = useMessages();
  useEffect(() => {
    if (!notice || notice.persistent) return;
    const t = window.setTimeout(() => {
      if (useAppStore.getState().notice?.id === notice.id) useAppStore.getState().dismissNotice();
    }, 5000);
    return () => window.clearTimeout(t);
  }, [notice]);
  if (!notice) return null;
  return (
    <div className="notice-wrap" style={{ top: top + 8 }}>
      <div className={`notice notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
        {notice.persistent && notice.kind === 'info' ? <span className="spinner" aria-hidden="true" /> : null}
        <span>{notice.text}</span>
        <button className="notice__close" onClick={() => useAppStore.getState().dismissNotice()} aria-label={m.ui.close}>
          <CloseIcon size={14} />
        </button>
      </div>
    </div>
  );
}

/** Asked before the browser's location prompt appears — explain first. */
export function LocationPrimer() {
  const open = useAppStore((s) => s.locationPrimer);
  const m = useMessages();
  if (!open) return null;
  return (
    <Dialog label={m.ui.allowLocation} onClose={() => useAppStore.getState().confirmLocationPrimer(false)}>
      <h2>{m.ui.allowLocation}</h2>
      <p>{m.ui.locationWhy}</p>
      <div className="dialog__actions">
        <button className="btn btn-primary" onClick={() => useAppStore.getState().confirmLocationPrimer(true)}>
          {m.ui.allowLocation}
        </button>
        <button className="btn btn-quiet" onClick={() => useAppStore.getState().confirmLocationPrimer(false)}>
          {m.ui.notNow}
        </button>
      </div>
    </Dialog>
  );
}

/** Started navigation far away from the planned route. */
export function NavPrompt() {
  const prompt = useAppStore((s) => s.navPrompt);
  const units = useSettings((s) => s.units.distance);
  const m = useMessages();
  if (!prompt) return null;
  return (
    <Dialog label={m.ui.farFromRoute(formatDistance(prompt.distanceM, units, m))} onClose={() => useAppStore.getState().resolveNavPrompt('cancel')}>
      <h2>{m.ui.farFromRoute(formatDistance(prompt.distanceM, units, m))}</h2>
      <p>{m.ui.farFromRouteBody}</p>
      <div className="dialog__actions">
        <button className="btn btn-primary" onClick={() => useAppStore.getState().resolveNavPrompt('route-from-here')}>
          {m.ui.routeFromHere}
        </button>
        <button className="btn btn-quiet" onClick={() => useAppStore.getState().resolveNavPrompt('simulate')}>
          {m.ui.simulateInstead}
        </button>
        <button className="btn btn-quiet" onClick={() => useAppStore.getState().resolveNavPrompt('cancel')}>
          {m.ui.cancel}
        </button>
      </div>
    </Dialog>
  );
}
