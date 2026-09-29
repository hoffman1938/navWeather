import { useRef, useState } from 'react';
import { useDismiss } from '../../hooks/useDismiss';
import { config } from '../../config';
import { formatDistance, formatDuration } from '../../i18n/format';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import { formatLocalTime } from '../../utils/timezone';
import { BottomSheet } from '../BottomSheet/BottomSheet';
import { EventIcon } from '../Common/EventIcon';
import { CloseIcon, PauseIcon, PlayIcon } from '../Icons/Icons';
import { PlacesPanel } from '../Places/PlacesPanel';
import { DataSources } from '../Plan/DataSources';
import { ElevationProfile } from '../Plan/ElevationProfile';
import { TimeScrubber } from '../TimeScrubber/TimeScrubber';
import { WeatherStrip } from '../WeatherStrip/WeatherStrip';
import { AheadList } from './AheadList';
import './Drive.css';

/** Driving: ETA bar + the next important thing; "Ahead" when pulled up. */
export function DriveSheet() {
  const m = useMessages();
  const sheet = useAppStore((s) => s.sheet);
  return (
    <BottomSheet
      state={sheet}
      onChange={(v) => useAppStore.getState().setSheet(v)}
      label={m.ui.navigation}
      header={<EtaBar />}
      body={<AheadList />}
      extra={
        <div className="drive-extra">
          <WeatherStrip />
          <ElevationProfile />
          <TimeScrubber />
          <PlacesPanel />
          <DataSources />
        </div>
      }
    />
  );
}

function EtaBar() {
  const m = useMessages();
  const units = useSettings((s) => s.units.distance);
  const mode = useAppStore((s) => s.mode);
  const remainingMin = useAppStore((s) => (s.progress ? Math.round(s.progress.remainingTimeS / 60) : null));
  const remainingM = useAppStore((s) => (s.progress ? Math.round(s.progress.remainingDistanceM / 100) * 100 : null));
  const etaMin = useAppStore((s) => (s.progress ? Math.round(s.progress.etaMs / 60000) : null));
  const destTz = useAppStore((s) => s.derived.points.at(-1)?.timezone ?? 'UTC');
  const simClockMin = useAppStore((s) => (s.mode === 'simulating' ? Math.floor(s.sim.nowMs / 60000) : null));
  const originTz = useAppStore((s) => s.derived.points[0]?.timezone ?? 'UTC');
  const next = useAppStore((s) => s.derived.intelligence.ahead.find((e) => e.type !== 'DESTINATION'));
  const simulating = mode === 'simulating';
  const simulatedData = useAppStore((s) => s.simulatedData);

  return (
    <div className="etabar">
      <div className="etabar__row">
        <div className="etabar__eta">
          <span className="etabar__time tabular">{etaMin !== null ? formatLocalTime(etaMin * 60000, destTz) : '–'}</span>
          <span className="etabar__cap">{m.ui.arrival}</span>
        </div>
        <div className="etabar__rem tabular">
          <span>{remainingMin !== null ? formatDuration(remainingMin * 60, m) : m.ui.waitingForLocation}</span>
          {remainingM !== null ? <span className="etabar__cap">{formatDistance(remainingM, units, m)}</span> : null}
        </div>
        <div className="etabar__controls">{simulating ? <SimControls /> : <EndButton />}</div>
      </div>
      {simulating && simClockMin !== null ? (
        <p className="etabar__sim">
          {m.ui.simulated} · <span className="tabular">{formatLocalTime(simClockMin * 60000, originTz)}</span>
          {simulatedData ? ` · ${m.ui.simulatedData}` : ''}
        </p>
      ) : null}
      {next ? (
        <p className="etabar__next">
          <EventIcon icon={next.icon} isDay={next.isDay} size={22} />
          <span>
            <strong>{next.title}</strong> {m.time.in(formatDuration(next.estimatedMinutesFromCurrent * 60, m))}
            {next.shortMessage ? ` · ${next.shortMessage}` : ''}
          </span>
        </p>
      ) : null}
    </div>
  );
}

function EndButton() {
  const m = useMessages();
  return (
    <button className="btn btn-danger" onClick={() => useAppStore.getState().stopNavigation()}>
      {m.ui.end}
    </button>
  );
}

function SimControls() {
  const m = useMessages();
  const playing = useAppStore((s) => s.sim.playing);
  const arrived = useAppStore((s) => s.sim.arrived);
  return (
    <>
      <button
        className="roundbtn roundbtn--primary"
        onClick={() => (playing ? useAppStore.getState().pauseSimulation() : useAppStore.getState().resumeSimulation())}
        aria-label={playing ? m.ui.pause : arrived ? m.ui.restart : m.ui.resume}
      >
        {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
      </button>
      <SpeedMenu />
      <button className="roundbtn" onClick={() => useAppStore.getState().exitSimulation()} aria-label={m.ui.exitSimulation}>
        <CloseIcon size={20} />
      </button>
    </>
  );
}

function SpeedMenu() {
  const m = useMessages();
  const speed = useAppStore((s) => s.sim.speed);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  return (
    <div className="speedmenu" ref={ref}>
      <button className="roundbtn tabular" aria-haspopup="menu" aria-expanded={open} aria-label={m.ui.speed(speed)} onClick={() => setOpen((o) => !o)}>
        {speed}×
      </button>
      {open ? (
        <div className="speedmenu__pop" role="menu">
          {config.simulation.speeds.map((v) => (
            <button
              key={v}
              role="menuitemradio"
              aria-checked={v === speed}
              className={`speedmenu__opt tabular${v === speed ? ' is-active' : ''}`}
              onClick={() => {
                useAppStore.getState().setSimulationSpeed(v);
                setOpen(false);
              }}
            >
              {v}×
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
