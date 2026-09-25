import { useEffect } from 'react';
import { useAppStore } from '../../state/store';
import { useLayoutStore } from '../../state/layout';
import { CloseIcon } from '../Icons/Icons';
import './Notice.css';

/** Transient status toast (auto-dismisses unless persistent). */
export function Notice() {
  const notice = useAppStore((s) => s.notice);
  const top = useLayoutStore((s) => s.insets.top);

  useEffect(() => {
    if (!notice || notice.persistent) return;
    const t = window.setTimeout(() => {
      if (useAppStore.getState().notice?.id === notice.id) useAppStore.getState().dismissNotice();
    }, 4500);
    return () => window.clearTimeout(t);
  }, [notice]);

  if (!notice) return null;
  return (
    <div className="notice-wrap" style={{ top: top + 10 }}>
      <div className={`notice notice--${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
        {notice.persistent ? <span className="spinner" aria-hidden="true" /> : null}
        <span>{notice.text}</span>
        <button className="notice__close" onClick={() => useAppStore.getState().dismissNotice()} aria-label="Dismiss">
          <CloseIcon size={14} />
        </button>
      </div>
    </div>
  );
}

/** Asked when "Start" is pressed far away from the planned route. */
export function NavPrompt() {
  const prompt = useAppStore((s) => s.navPrompt);
  if (!prompt) return null;
  const km = Math.round(prompt.distanceM / 1000);
  return (
    <div className="prompt-backdrop">
      <div className="prompt" role="dialog" aria-modal="true" aria-labelledby="prompt-title">
        <h2 id="prompt-title">You're {km.toLocaleString()} km from this route</h2>
        <p>Start navigation from where you are now, or watch a simulated drive of the planned route instead.</p>
        <div className="prompt__actions">
          <button className="btn btn-primary" onClick={() => useAppStore.getState().resolveNavPrompt('route-from-here')}>
            Route from my location
          </button>
          <button className="btn btn-secondary" onClick={() => useAppStore.getState().resolveNavPrompt('simulate')}>
            Simulate the drive
          </button>
          <button className="btn btn-ghost" onClick={() => useAppStore.getState().resolveNavPrompt('cancel')}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
