import { useEffect, useRef, useState } from 'react';
import { config } from '../../config';
import { useAppStore } from '../../state/store';
import { formatDistance, formatDuration } from '../../utils/time';
import { deviceTimeZone, formatLocalTime } from '../../utils/timezone';
import { conditionLabel, formatTemp, placeLabel } from '../../ui/weatherText';
import { CloseIcon, PauseIcon, PlayIcon } from '../Icons/Icons';
import { WeatherIcon } from '../WeatherIcon/WeatherIcon';
import './NavigationStatus.css';

/** Header while driving (live GPS) or simulating: remaining time/distance + controls. */
export function NavigationStatus() {
  const mode = useAppStore((s) => s.mode);
  // Minute-rounded selectors keep this from re-rendering every animation frame.
  const remainingMin = useAppStore((s) => (s.progress ? Math.round(s.progress.remainingTimeS / 60) : null));
  const remainingKm = useAppStore((s) => (s.progress ? Math.round(s.progress.remainingDistanceM / 1000) : null));
  const etaMin = useAppStore((s) => (s.progress ? Math.round(s.progress.etaMs / 60000) : null));
  const simClockMin = useAppStore((s) => (s.mode === 'simulating' ? Math.floor(s.sim.nowMs / 60000) : null));
  const playing = useAppStore((s) => s.sim.playing);
  const arrived = useAppStore((s) => s.sim.arrived);
  const speed = useAppStore((s) => s.sim.speed);
  const recalculating = useAppStore((s) => s.recalculating);
  const deviation = useAppStore((s) => s.deviation.status);
  const destTz = useAppStore((s) => s.derived.points.at(-1)?.timezone ?? deviceTimeZone());
  const originTz = useAppStore((s) => s.derived.points[0]?.timezone ?? deviceTimeZone());
  const destination = useAppStore((s) => s.plan?.timed.route.destination.name ?? '');
  const next = useAppStore((s) => s.derived.displayPoints.find((p) => p.weather && p.estimatedTravelMinutes > 0));

  const simulating = mode === 'simulating';

  return (
    <div className="navstat">
      <div className="navstat__row">
        <div className="navstat__main">
          <p className="navstat__eyebrow">
            {simulating ? (
              <>
                <span className="navstat__badge">Simulation</span>
                {simClockMin !== null ? (
                  <span className="tabular">{formatLocalTime(simClockMin * 60000, originTz)}</span>
                ) : null}
              </>
            ) : recalculating ? (
              'Recalculating route…'
            ) : deviation === 'uncertain' ? (
              'Checking your position…'
            ) : (
              <>To {destination}</>
            )}
          </p>
          <p className="navstat__remaining tabular">
            {remainingMin === null ? 'Locating…' : arrived ? 'Arrived' : formatDuration(remainingMin * 60)}
          </p>
          {remainingKm !== null && etaMin !== null && !arrived ? (
            <p className="navstat__meta tabular">
              {formatDistance(remainingKm * 1000)} · Arrive {formatLocalTime(etaMin * 60000, destTz)}
            </p>
          ) : null}
        </div>
        <div className="navstat__controls">
          {simulating ? (
            <>
              <button
                className="navstat__btn navstat__btn--primary"
                onClick={() =>
                  playing ? useAppStore.getState().pauseSimulation() : useAppStore.getState().resumeSimulation()
                }
                aria-label={playing ? 'Pause simulation' : arrived ? 'Restart simulation' : 'Resume simulation'}
              >
                {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
              </button>
              <SpeedMenu speed={speed} />
              <button
                className="navstat__btn"
                onClick={() => useAppStore.getState().exitSimulation()}
                aria-label="Exit simulation"
              >
                <CloseIcon size={20} />
              </button>
            </>
          ) : (
            <button className="btn navstat__end" onClick={() => useAppStore.getState().stopNavigation()}>
              End
            </button>
          )}
        </div>
      </div>
      {next?.weather ? (
        <p className="navstat__next">
          <WeatherIcon condition={next.weather.condition} isDay={next.weather.isDay} size={22} />
          <span>
            <strong>{placeLabel(next)}</strong> in {formatDuration(next.estimatedTravelMinutes * 60)} ·{' '}
            {conditionLabel(next.weather)} {formatTemp(next.weather.temperature)}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** Simulation speed picker (1×, 2×, 5×, 10×, plus fast demo speeds). */
function SpeedMenu({ speed }: { speed: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="speed" ref={ref}>
      <button
        className="navstat__btn navstat__speed tabular"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Simulation speed ${speed}×`}
        onClick={() => setOpen((o) => !o)}
      >
        {speed}×
      </button>
      {open ? (
        <div className="speed__menu" role="menu" aria-label="Simulation speed">
          {config.simulation.speeds.map((v) => (
            <button
              key={v}
              role="menuitemradio"
              aria-checked={v === speed}
              className={`speed__opt tabular${v === speed ? ' is-active' : ''}`}
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
