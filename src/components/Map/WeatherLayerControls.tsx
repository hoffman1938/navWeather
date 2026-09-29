import { useEffect, useRef, useState } from 'react';
import type { LayerKind } from '../../algorithms/weatherGrid';
import { useExplore } from '../../state/explore';
import { useMessages, useSettings } from '../../state/settings';
import { formatTemp } from '../../i18n/format';
import { deviceTimeZone, formatLocalTime } from '../../utils/timezone';
import { CloseIcon, LayersIcon, PauseIcon, PlayIcon } from '../Icons/Icons';
import { layerTime } from './useWeatherLayer';
import { useDismiss } from '../../hooks/useDismiss';
import './WeatherLayer.css';

/** Map button: choose a forecast layer (off / precipitation / temperature). */
export function LayersButton() {
  const m = useMessages();
  const layer = useExplore((s) => s.layer);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const options: ['off' | LayerKind, string][] = [
    ['off', m.layers.off],
    ['precip', m.layers.precip],
    ['temp', m.layers.temp],
  ];
  return (
    <div className="layers" ref={ref}>
      <button className={`fab${layer !== 'off' ? ' fab--on' : ''}`} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={m.layers.title} title={m.layers.title}>
        <LayersIcon size={22} />
      </button>
      {open ? (
        <div className="popover layers__pop" role="menu" aria-label={m.layers.title}>
          {options.map(([id, label]) => (
            <button
              key={id}
              className="popover__row"
              role="menuitemradio"
              aria-checked={layer === id}
              onClick={() => {
                useExplore.getState().setLayer(id);
                setOpen(false);
              }}
            >
              <span>{label}</span>
              {layer === id ? <span className="savemenu__check" aria-hidden="true">✓</span> : null}
            </button>
          ))}
          <p className="layers__note">{m.layers.forecastNote}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Time slider for the forecast layer: now … +24 h, with play. */
export function LayerTimeline() {
  const m = useMessages();
  const temp = useSettings((s) => s.units.temperature);
  const layer = useExplore((s) => s.layer);
  const hour = useExplore((s) => s.layerHour);
  const status = useExplore((s) => s.layerStatus);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      const h = useExplore.getState().layerHour;
      if (h >= 24) setPlaying(false);
      else useExplore.getState().setLayerHour(h + 1);
    }, 700);
    return () => window.clearInterval(t);
  }, [playing]);

  if (layer === 'off') return null;
  const at = layerTime(hour) - 30 * 60_000;
  const time = formatLocalTime(at, deviceTimeZone());
  const title = layer === 'precip' ? m.layers.precip : m.layers.temp;
  return (
    <div className="layerbar" role="group" aria-label={title}>
      <div className="layerbar__top">
        <button className="icon-btn" onClick={() => (hour >= 24 ? (useExplore.getState().setLayerHour(0), setPlaying(true)) : setPlaying((p) => !p))} aria-label={playing ? m.ui.pause : m.layers.play}>
          {playing ? <PauseIcon size={18} /> : <PlayIcon size={16} />}
        </button>
        <p className="layerbar__label" aria-live="polite">
          <strong className="layerbar__title">{title}</strong>
          <span className="layerbar__time">
            <span className="tabular">{hour === 0 ? m.time.now : `${time} (+${hour} ${m.units.h})`}</span>
            {status === 'loading' ? <span className="spinner layerbar__spin" aria-hidden="true" /> : null}
            {status === 'error' ? <span className="layerbar__err"> · {m.weather.summary.unavailable}</span> : null}
            {status === 'partial' ? <span className="layerbar__err"> · {m.layers.partial}</span> : null}
          </span>
        </p>
        <button className="icon-btn" onClick={() => useExplore.getState().setLayer('off')} aria-label={m.ui.close}>
          <CloseIcon size={18} />
        </button>
      </div>
      <input
        className="layerbar__slider"
        type="range"
        min={0}
        max={24}
        step={1}
        value={hour}
        onChange={(e) => {
          setPlaying(false);
          useExplore.getState().setLayerHour(Number(e.target.value));
        }}
        aria-label={m.layers.hourLabel}
        aria-valuetext={hour === 0 ? m.time.now : time}
      />
      <div className={`layerbar__legend layerbar__legend--${layer}`} aria-hidden="true">
        <span>{layer === 'precip' ? m.layers.light : formatTemp(-10, temp)}</span>
        <span className="layerbar__ramp" />
        <span>{layer === 'precip' ? m.layers.heavy : formatTemp(30, temp)}</span>
      </div>
      <p className="layerbar__note">{m.layers.forecastNote}</p>
    </div>
  );
}
