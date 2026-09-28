import { useEffect, useState } from 'react';
import { conditionText, formatAgo, formatDistance, formatSpeed, formatTemp } from '../../i18n/format';
import { placeUrl } from '../../share/links';
import { useViewer } from '../../share/viewer';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import type { WeatherAtTime } from '../../types/weather';
import { deviceTimeZone, formatLocalTime } from '../../utils/timezone';
import { BottomSheet } from '../BottomSheet/BottomSheet';
import { DirectionsIcon, LiveIcon, LocateIcon } from '../Icons/Icons';
import { WeatherIcon } from '../WeatherIcon/WeatherIcon';
import './Live.css';

/** How old a position may get before the viewer is told it may be stale. */
const STALE_MS = 90_000;

function useNow(periodMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(t);
  }, [periodMs]);
  return now;
}

/** The screen someone sees when they open a live-location link. */
export function LiveView() {
  const m = useMessages();
  const status = useViewer((s) => s.status);
  const name = useViewer((s) => s.snapshot?.name);
  const [sheet, setSheet] = useState<'compact' | 'default' | 'expanded'>('default');
  const title = status === 'ended' ? (name ?? m.share.viewerTitle) : name ? m.share.sharedBy(name) : m.share.sharedAnon;
  return (
    <>
      <a className="live-brand" href="/">
        navWeather
      </a>
      <BottomSheet
        state={sheet}
        onChange={setSheet}
        label={m.share.viewerTitle}
        header={
          <div className="live-head">
            <span className="live-head__icon" aria-hidden="true">
              <LiveIcon size={22} />
            </span>
            <div className="live-head__text">
              <h2 className="live-head__title">{status === 'notfound' ? m.share.viewerTitle : title}</h2>
              <LiveStatus />
            </div>
          </div>
        }
        body={status === 'notfound' ? <NotFound /> : <LiveBody />}
      />
    </>
  );
}

function LiveStatus() {
  const m = useMessages();
  const status = useViewer((s) => s.status);
  const updatedAt = useViewer((s) => s.snapshot?.updatedAt ?? null);
  const hasPos = useViewer((s) => !!s.snapshot?.pos);
  const online = useAppStore((s) => s.online);
  const now = useNow(5000);
  let text: string;
  let tone: 'live' | 'warn' | 'off' = 'off';
  if (status === 'notfound') text = m.share.notFound;
  else if (status === 'ended') text = m.share.viewerEnded;
  else if (!online) {
    text = m.share.offline;
    tone = 'warn';
  } else if (status === 'connecting') text = m.share.connecting;
  else if (!hasPos || !updatedAt) text = m.share.noPosition;
  else if (now - updatedAt > STALE_MS) {
    text = m.share.stale(formatAgo(updatedAt, now, m));
    tone = 'warn';
  } else {
    text = `${m.share.live} · ${m.share.updated(formatAgo(updatedAt, now, m))}`;
    tone = status === 'reconnecting' ? 'warn' : 'live';
  }
  return (
    <p className={`live-status live-status--${tone}`} role="status">
      <span className="live-status__dot" aria-hidden="true" />
      {text}
    </p>
  );
}

function NotFound() {
  const m = useMessages();
  return (
    <div className="live-body">
      <a className="btn btn-primary" href="/">
        {m.share.openApp}
      </a>
    </div>
  );
}

function WeatherRow({ label, w, temp }: { label: string; w: WeatherAtTime; temp: 'c' | 'f' }) {
  const m = useMessages();
  return (
    <li className="live-wx">
      <WeatherIcon condition={w.condition} isDay={w.isDay} size={32} />
      <span className="live-wx__text">
        <span className="live-wx__label">{label}</span>
        <span className="live-wx__value">
          <strong className="tabular">{formatTemp(w.temperature, temp)}</strong> {conditionText(w, m)}
          {w.precipitationProbability !== undefined && w.precipitationProbability >= 20
            ? ` · ${m.explore.rainChance(`${Math.round(w.precipitationProbability / 5) * 5}%`)}`
            : ''}
        </span>
      </span>
    </li>
  );
}

function LiveBody() {
  const m = useMessages();
  const units = useSettings((s) => s.units);
  const snap = useViewer((s) => s.snapshot);
  const weather = useViewer((s) => s.weather);
  const follow = useViewer((s) => s.follow);
  const status = useViewer((s) => s.status);
  if (!snap) return null;
  const trip = snap.trip;
  const tz = weather.destination?.timezone ?? deviceTimeZone();
  const speed = snap.pos?.spd !== undefined && snap.pos.spd > 1.5 ? formatSpeed(snap.pos.spd * 3.6, units.distance, m) : null;
  return (
    <div className="live-body">
      {snap.sim ? <p className="live-tag">{m.share.simulatedTag}</p> : null}
      {trip ? (
        <div className="live-trip">
          <p className="live-trip__dest">{m.share.headingTo(trip.dest.name)}</p>
          <p className="live-trip__meta tabular">
            {[trip.eta ? m.share.arrives(formatLocalTime(trip.eta, tz)) : null, trip.remM !== undefined ? m.share.toGo(formatDistance(trip.remM, units.distance, m)) : null, speed]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      ) : speed ? (
        <p className="live-trip__meta tabular">{speed}</p>
      ) : null}
      <ul className="rows live-weather">
        {weather.here ? <WeatherRow label={m.share.weatherThere} w={weather.here.weather} temp={units.temperature} /> : null}
        {trip && weather.destination?.weather ? (
          <WeatherRow
            label={m.share.weatherAtDest(trip.dest.name, formatLocalTime(weather.destination.arrivalMs, weather.destination.timezone))}
            w={weather.destination.weather}
            temp={units.temperature}
          />
        ) : null}
      </ul>
      <div className="live-actions">
        {status !== 'ended' ? (
          <button className={`btn ${follow ? 'btn-quiet' : 'btn-primary'}`} onClick={() => useViewer.getState().setFollow(true)} disabled={follow || !snap.pos}>
            <LocateIcon size={18} />
            {m.share.follow}
          </button>
        ) : null}
        {snap.pos ? (
          <a className="btn btn-quiet" href={placeUrl({ id: 'live', name: snap.name ?? m.share.viewerTitle, label: '', coordinate: snap.pos.c })}>
            <DirectionsIcon size={18} />
            {m.share.directions}
          </a>
        ) : null}
      </div>
      {status !== 'ended' ? <p className="live-until">{m.share.visibleUntil(formatLocalTime(snap.expiresAt, deviceTimeZone()))}</p> : null}
    </div>
  );
}
