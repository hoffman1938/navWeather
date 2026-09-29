import { useEffect } from 'react';
import { REPORT_KINDS, type ReportKind } from '../../reports/protocol';
import { getProviders } from '../../services/providers';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { EventIcon } from '../Common/EventIcon';
import { Dialog } from '../Common/Dialog';
import { AlertIcon, CloseIcon } from '../Icons/Icons';

/** Reporting is offered while driving, when the provider accepts reports and the user hasn't turned them off. */
function useCanReport(): boolean {
  const driving = useAppStore((s) => s.mode !== 'planning' && s.arrival === null);
  const on = useSettings((s) => s.driverReports);
  return driving && on && typeof getProviders().incidents.report === 'function';
}

/** Map button (drive mode): opens the report sheet. */
export function ReportButton() {
  const m = useMessages();
  const can = useCanReport();
  const sending = useAppStore((s) => s.reportSending);
  if (!can) return null;
  return (
    <button
      className="fab fab--report"
      onClick={() => useAppStore.getState().setReportDialogOpen(true)}
      aria-label={m.reports.button}
      title={m.reports.button}
      aria-busy={sending}
    >
      {sending ? <span className="spinner" aria-hidden="true" /> : <AlertIcon size={22} />}
    </button>
  );
}

const KIND_ICON: Record<ReportKind, Parameters<typeof EventIcon>[0]['icon']> = {
  accident: 'incident',
  hazard: 'incident',
  roadworks: 'incident',
  closure: 'incident',
  weather: 'ice',
};

/** Big, glanceable choices — one tap sends the report at the car's position. */
export function ReportDialog() {
  const m = useMessages();
  const open = useAppStore((s) => s.reportDialogOpen);
  const simulating = useAppStore((s) => s.mode === 'simulating');
  const sending = useAppStore((s) => s.reportSending);
  if (!open) return null;
  const close = () => useAppStore.getState().setReportDialogOpen(false);
  return (
    <Dialog label={m.reports.title} onClose={close}>
      <h2>{m.reports.title}</h2>
      {simulating ? <p className="report__sim">{m.reports.simulated}</p> : null}
      <ul className="report__kinds">
        {REPORT_KINDS.map((k) => (
          <li key={k}>
            <button
              className={`report__kind report__kind--${k}`}
              disabled={simulating || sending}
              onClick={() => void useAppStore.getState().reportIncident(k)}
            >
              <EventIcon icon={KIND_ICON[k]} size={28} />
              <span className="report__kindText">
                <strong>{m.reports.kinds[k]}</strong>
                <small>{m.reports.hints[k]}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="report__note">{m.reports.note}</p>
      <div className="dialog__actions">
        <button className="btn btn-quiet" onClick={close}>
          {m.ui.cancel}
        </button>
      </div>
    </Dialog>
  );
}

/** How long "still there?" waits for an answer before it goes away by itself. */
const PROMPT_MS = 20_000;

/** "Accident — still there?" right after passing another driver's report. */
export function ReportPrompt() {
  const m = useMessages();
  const prompt = useAppStore((s) => s.reportPrompt);
  useEffect(() => {
    if (!prompt) return;
    const t = window.setTimeout(() => {
      if (useAppStore.getState().reportPrompt === prompt) useAppStore.getState().answerReportPrompt(null);
    }, PROMPT_MS);
    return () => window.clearTimeout(t);
  }, [prompt]);
  if (!prompt) return null;
  const what = m.reports.kinds[prompt.kind] ?? m.alert.incident[prompt.kind] ?? m.alert.title.INCIDENT;
  const answer = (v: 'still' | 'gone' | null) => useAppStore.getState().answerReportPrompt(v);
  return (
    <section className="reroute report-prompt" aria-label={m.reports.stillThere(what)}>
      <div className="reroute__head">
        <EventIcon icon="incident" size={28} />
        <p className="reroute__text">
          <strong>{m.reports.stillThere(what)}</strong>
          <small>{m.reports.stillThereHint}</small>
        </p>
        <button className="icon-btn report-prompt__close" onClick={() => answer(null)} aria-label={m.ui.close}>
          <CloseIcon size={18} />
        </button>
      </div>
      <div className="reroute__actions">
        <button className="btn btn-primary" onClick={() => answer('still')}>
          {m.reports.yes}
        </button>
        <button className="btn btn-quiet" onClick={() => answer('gone')}>
          {m.reports.no}
        </button>
      </div>
    </section>
  );
}
