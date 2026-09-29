import { useEffect, useState } from 'react';
import { getProviders } from '../services/providers';
import { useLiveShare } from '../share/liveShare';
import { locationWatcher, useExplore } from '../state/explore';
import { getVoiceQueue, maybeOfferWeatherReroute, useAppStore, weatherRerouteDiagnostics } from '../state/store';
import { simulateDeviation, simulateIncident, simulateWeatherChange, skipKm, skipMinutes, skipToNextEvent } from './devTools';
import './DevPanel.css';

/**
 * DEVELOPMENT-ONLY diagnostics + simulation controls. Loaded lazily behind
 * `import.meta.env.DEV`, so it is not part of production builds. Toggle with
 * the "dev" tab or Ctrl/⌘+Shift+D.
 */
export default function DevPanel() {
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [open]);

  if (!open) {
    return (
      <button className="devtab" onClick={() => setOpen(true)} title="Developer panel (Ctrl/⌘+Shift+D)">
        dev
      </button>
    );
  }

  const s = useAppStore.getState();
  const ex = useExplore.getState();
  const share = useLiveShare.getState();
  const p = getProviders();
  const w = p.weather.stats;
  const plan = s.plan;
  const now = s.mode === 'simulating' ? s.sim.nowMs : Date.now();
  const fix = ex.myLocation;
  const events = s.derived.intelligence.events.filter((e) => e.type !== 'DESTINATION').slice(0, 8);
  const sim = s.mode === 'simulating';
  const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
  const hm = (sec: number) => `${Math.floor(sec / 3600)}h${String(Math.round((sec % 3600) / 60)).padStart(2, '0')}`;
  const time = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString().slice(11, 16) + 'Z' : '–');

  return (
    <aside className="devpanel" aria-label="Developer panel">
      <header>
        <strong>Diagnostics</strong> <span className="devpanel__mode">{s.mode}{s.simulatedData ? ' · SIMULATED DATA' : ''}</span>
        <button onClick={() => setOpen(false)} aria-label="Close developer panel">×</button>
      </header>
      {sim ? (
        <section>
          <h4>Simulation</h4>
          <div className="devpanel__btns">
            <button onClick={() => skipKm(10)}>+10 km</button>
            <button onClick={() => skipMinutes(30)}>+30 min</button>
            <button onClick={skipToNextEvent}>Next event</button>
            <button onClick={simulateDeviation}>Deviate</button>
            <button onClick={simulateWeatherChange}>Heavy rain ahead</button>
            <button onClick={simulateIncident}>Accident report</button>
            <button onClick={() => void maybeOfferWeatherReroute(true)}>Weather re-route check</button>
          </div>
          {weatherRerouteDiagnostics() ? <p className="devpanel__note">Re-route: {weatherRerouteDiagnostics()}</p> : null}
        </section>
      ) : null}
      <section>
        <h4>Route</h4>
        {plan ? (
          <dl>
            <dt>provider</dt>
            <dd>{plan.timed.route.provider} · {plan.timed.route.segmentSource}</dd>
            <dt>distance / time</dt>
            <dd>{km(plan.timed.totalDistM)} · {hm(plan.timed.totalTimeS)}</dd>
            <dt>samples / points</dt>
            <dd>{plan.samples.length} / {s.derived.points.length} ({s.derived.displayPoints.length} shown)</dd>
            <dt>progress</dt>
            <dd>{s.progress ? `${km(s.progress.distanceAlongM)} · off-route ${Math.round(s.progress.distanceFromRouteM)} m · ${s.deviation.status}` : '–'}</dd>
            <dt>ETA</dt>
            <dd>{time(s.derived.arrivalMs)} (now {time(now)})</dd>
          </dl>
        ) : (
          <p>no route</p>
        )}
      </section>
      <section>
        <h4>Weather ({p.weather.constructor.name})</h4>
        <dl>
          <dt>requests / locations</dt>
          <dd>{w.httpRequests} / {w.fetchedLocations} · last {w.lastRequestMs} ms</dd>
          <dt>cache hits / shared</dt>
          <dd>{w.cacheHits} of {w.lookups} lookups · {w.sharedInflight} shared in-flight</dd>
          <dt>failures / stale</dt>
          <dd>{w.failures} / {w.staleServed}</dd>
          <dt>status</dt>
          <dd>{s.weatherStatus}{s.weatherStale ? ' (stale)' : ''} · updated {time(s.weatherUpdatedAt)}</dd>
        </dl>
      </section>
      <section>
        <h4>Upcoming events</h4>
        <ol className="devpanel__events">
          {events.map((e) => (
            <li key={e.id}>
              <span>{e.type}</span> <span>{e.severity}</span> <span>+{e.estimatedMinutesFromCurrent}m</span> <span>{km(e.distanceFromCurrentM)}</span>{' '}
              <span>c{e.confidence.toFixed(2)}</span>
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h4>Alerts & voice</h4>
        <dl>
          <dt>tracked / voice last hour</dt>
          <dd>{Object.keys(s.alertState.events).length} / {s.alertState.recent.length}</dd>
          <dt>banner</dt>
          <dd>{s.activeAlert?.title ?? '–'}</dd>
        </dl>
        <ol className="devpanel__log">
          {getVoiceQueue()
            .log.slice(-4)
            .map((l, i) => (
              <li key={i}>
                {new Date(l.at).toISOString().slice(11, 19)} {l.text}
              </li>
            ))}
        </ol>
      </section>
      <section>
        <h4>Providers & device</h4>
        <dl>
          <dt>routing / geocode</dt>
          <dd>{p.routing.name} / {p.geocoding.name}</dd>
          <dt>poi / speed / traffic / incidents</dt>
          <dd>{p.poi?.name ?? 'off'} / {p.speedLimits?.name ?? 'off'} / {p.traffic.name} / {p.incidents.name}</dd>
          <dt>location</dt>
          <dd>
            [{locationWatcher.reasons.join(', ') || 'idle'}] {fix ? `±${Math.round(fix.accuracyM ?? 0)} m, ${Math.round((Date.now() - fix.timestampMs) / 1000)} s ago` : 'no fix'}
            {ex.locationError ? ` · ${ex.locationError}` : ''}
          </dd>
          <dt>live share</dt>
          <dd>{share.status}{share.lastSentAt ? ` · sent ${Math.round((Date.now() - share.lastSentAt) / 1000)} s ago` : ''}{share.failing ? ' · failing' : ''}</dd>
          <dt>online</dt>
          <dd>{String(s.online)}</dd>
        </dl>
      </section>
    </aside>
  );
}
