import { useEffect, useState } from 'react';
import { canNativeShare, copyText, nativeShare, placeUrl } from '../../share/links';
import { useLiveShare } from '../../share/liveShare';
import { useExplore } from '../../state/explore';
import { useMessages } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { deviceTimeZone, formatLocalTime } from '../../utils/timezone';
import { Dialog } from '../Common/Dialog';
import { LiveIcon, ShareIcon } from '../Icons/Icons';
import './Share.css';

/** Read-only link with Copy and (where the OS has one) the system share sheet. */
function LinkBox({ url, title, text }: { url: string; title: string; text?: string }) {
  const m = useMessages();
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  useEffect(() => setCopied('idle'), [url]);
  return (
    <div className="linkbox">
      <input className="linkbox__url" readOnly value={url} aria-label={m.explore.link} onFocus={(e) => e.currentTarget.select()} />
      <div className="linkbox__actions">
        <button className="btn btn-primary" onClick={async () => setCopied((await copyText(url)) ? 'ok' : 'fail')}>
          {copied === 'ok' ? m.explore.copied : m.explore.copy}
        </button>
        {canNativeShare() ? (
          <button className="btn btn-quiet" onClick={() => void nativeShare({ title, text, url })}>
            <ShareIcon size={18} />
            {m.explore.shareVia}
          </button>
        ) : null}
      </div>
      {copied === 'fail' ? (
        <p className="linkbox__warn" role="status">
          {m.explore.copyFailed}
        </p>
      ) : null}
    </div>
  );
}

/** Share a place (search result or dropped pin) as a link. */
export function SharePlaceDialog() {
  const place = useExplore((s) => s.sharePlace);
  const m = useMessages();
  if (!place) return null;
  const close = () => useExplore.getState().closeSharePlace();
  return (
    <Dialog label={m.explore.shareTitle} onClose={close}>
      <h2>{m.explore.shareTitle}</h2>
      <p className="share__place">
        <strong>{place.name}</strong>
        {place.label && place.label !== place.name ? <span>{place.label}</span> : null}
      </p>
      <LinkBox url={placeUrl(place)} title={place.name} />
      <p className="share__note">{m.explore.shareNote}</p>
    </Dialog>
  );
}

const closeLiveDialog = () => useLiveShare.getState().closeDialog();

const DURATIONS = [
  [60, 'd1'],
  [240, 'd4'],
  [480, 'd8'],
  [1440, 'd24'],
] as const;

/** Start / manage live location sharing. */
export function LiveShareDialog() {
  // Narrow selectors: a position update must not re-render (and re-focus) the dialog.
  const open = useLiveShare((st) => st.dialogOpen);
  const status = useLiveShare((st) => st.status);
  const url = useLiveShare((st) => st.url);
  const expiresAt = useLiveShare((st) => st.expiresAt);
  const savedName = useLiveShare((st) => st.name);
  const error = useLiveShare((st) => st.error);
  const m = useMessages();
  const simulating = useAppStore((st) => st.mode === 'simulating');
  const [minutes, setMinutes] = useState(60);
  const [name, setName] = useState(savedName);
  if (!open) return null;
  const s = useLiveShare.getState();
  const close = closeLiveDialog;

  if ((status === 'active' || status === 'paused') && url) {
    const until = expiresAt ? formatLocalTime(expiresAt, deviceTimeZone()) : '';
    return (
      <Dialog label={m.share.title} onClose={close}>
        <h2>{m.share.active}</h2>
        <p className="share__lead">
          {m.share.ready} <span className="share__until">({m.share.until(until)})</span>
        </p>
        <LinkBox url={url} title={m.share.viewerTitle} text={savedName ? m.share.sharedBy(savedName) : m.share.sharedAnon} />
        <p className="share__note">{simulating ? m.share.simulated : m.share.foreground}</p>
        <div className="dialog__actions">
          <button
            className="btn btn-danger"
            onClick={() => {
              void s.stop();
              close();
            }}
          >
            {m.share.stop}
          </button>
          <button className="btn btn-quiet" onClick={close}>
            {m.ui.close}
          </button>
        </div>
      </Dialog>
    );
  }

  const busy = status === 'starting';
  return (
    <Dialog label={m.share.title} onClose={close}>
      <h2>{m.share.title}</h2>
      <p className="share__lead">{m.share.body}</p>
      <form
        className="share__form"
        onSubmit={(e) => {
          e.preventDefault();
          void s.start({ minutes, name: name.trim() });
        }}
      >
        <label className="share__field">
          <span>{m.share.name}</span>
          <input type="text" value={name} maxLength={40} autoComplete="nickname" placeholder={m.share.namePlaceholder} onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="share__durations">
          <legend>{m.share.duration}</legend>
          {DURATIONS.map(([min, key]) => (
            <label key={min} className={`chip${minutes === min ? ' is-on' : ''}`}>
              <input type="radio" name="share-duration" value={min} checked={minutes === min} onChange={() => setMinutes(min)} />
              {m.share[key]}
            </label>
          ))}
        </fieldset>
        <p className="share__note">{simulating ? m.share.simulated : m.share.foreground}</p>
        <p className="share__note">{m.share.privacy}</p>
        {error ? (
          <p className="share__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="dialog__actions">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? <span className="spinner" aria-hidden="true" /> : <LiveIcon size={18} />}
            {busy ? m.share.creating : m.share.create}
          </button>
          <button
            className="btn btn-quiet"
            type="button"
            onClick={() => {
              s.cancelStart(); // abandons a link still being created — nothing is shared
              close();
            }}
          >
            {m.ui.cancel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Always-visible reminder while location is being shared. */
export function ShareStatus() {
  const m = useMessages();
  const status = useLiveShare((s) => s.status);
  const expiresAt = useLiveShare((s) => s.expiresAt);
  const failing = useLiveShare((s) => s.failing);
  const sent = useLiveShare((s) => s.lastSentAt !== null);
  if (status === 'paused') {
    return (
      <div className="share-pill is-paused" role="status">
        <span className="share-pill__main share-pill__main--static">
          <span className="share-pill__dot" aria-hidden="true" />
          <span className="share-pill__text">{m.share.paused}</span>
        </span>
        <button className="share-pill__stop" onClick={() => useLiveShare.getState().resume()}>
          {m.share.resume}
        </button>
        <button className="share-pill__stop" onClick={() => void useLiveShare.getState().stop()}>
          {m.share.stop}
        </button>
      </div>
    );
  }
  if (status !== 'active') return null;
  const detail = failing ? m.share.reconnecting : !sent ? m.share.waitingFix : expiresAt ? m.share.until(formatLocalTime(expiresAt, deviceTimeZone())) : '';
  return (
    <div className={`share-pill${failing ? ' is-failing' : ''}`} role="status">
      <button className="share-pill__main" onClick={() => useLiveShare.getState().openDialog()}>
        <span className="share-pill__dot" aria-hidden="true" />
        <span className="share-pill__text">
          {m.share.active}
          {detail ? <span className="share-pill__detail"> · {detail}</span> : null}
        </span>
      </button>
      <button className="share-pill__stop" onClick={() => void useLiveShare.getState().stop()}>
        {m.share.stop}
      </button>
    </div>
  );
}
