import { useEffect, useState } from 'react';
import { formatDuration } from '../../i18n/format';
import { useMessages } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { EventIcon } from '../Common/EventIcon';
import { CloseIcon } from '../Icons/Icons';

/**
 * Proactive warning ("Heavy rain · in 32 min · near Khashuri"). Severity is
 * carried by an icon and a word, not colour alone. Hides itself after a
 * while; dismissing acknowledges it so it is never repeated.
 */
export function AlertBanner() {
  const alert = useAppStore((s) => s.activeAlert);
  const m = useMessages();
  const [visibleId, setVisibleId] = useState<string | null>(null);

  useEffect(() => {
    if (!alert) return;
    setVisibleId(alert.id);
    const t = window.setTimeout(() => setVisibleId(null), alert.severity === 'critical' ? 30_000 : 12_000);
    return () => window.clearTimeout(t);
  }, [alert]);

  if (!alert || visibleId !== alert.id) return null;
  const severe = alert.severity === 'critical' || alert.severity === 'high';
  return (
    <div className={`alert alert--${alert.severity}`} role={alert.severity === 'critical' ? 'alert' : 'status'}>
      <EventIcon icon={alert.icon} size={30} />
      <p className="alert__text">
        <strong>{alert.title}</strong>
        <span className="tabular">
          {m.time.in(formatDuration(alert.minutes * 60, m))}
          {alert.message ? ` · ${alert.message}` : ''}
        </span>
      </p>
      {severe ? <span className="sr-only">{alert.severity}</span> : null}
      <button className="icon-btn" onClick={() => useAppStore.getState().dismissAlert()} aria-label={m.ui.close}>
        <CloseIcon size={18} />
      </button>
    </div>
  );
}
