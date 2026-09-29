import { useId, useMemo } from 'react';
import { conditionText, formatTemp } from '../../i18n/format';
import { useMessages, useSettings } from '../../state/settings';
import { useAppStore } from '../../state/store';
import type { RouteWeatherPoint } from '../../types/weather';

const W = 360;
const H = 96;

/** Temperature → fill colour (cold blue … hot orange); the text always states the value. */
function tempColor(t: number): string {
  if (t <= 0) return '#4f8fe6';
  if (t <= 7) return '#5aa9c9';
  if (t <= 16) return '#7fb08a';
  if (t <= 25) return '#e0a53c';
  return '#e0663a';
}

/**
 * The road's height with the temperature you'll meet at each part of it:
 * passes are where snow and ice start, so the highest point is labelled
 * with its ETA and forecast. Hidden on flat routes.
 */
export function ElevationProfile() {
  const m = useMessages();
  const unit = useSettings((s) => s.units.temperature);
  const plan = useAppStore((s) => s.plan);
  const points = useAppStore((s) => s.derived.points);
  const progressM = useAppStore((s) => (s.mode !== 'planning' ? (s.progress?.distanceAlongM ?? null) : null));
  const gid = useId().replace(/:/g, '');
  const profile = plan?.elevation;

  const view = useMemo(() => {
    if (!plan || !profile || profile.elevationsM.length < 3) return null;
    const total = plan.timed.totalDistM;
    const min = Math.min(...profile.elevationsM);
    const max = Math.max(...profile.elevationsM);
    if (max - min < 150) return null;
    const x = (d: number) => (d / total) * W;
    const y = (e: number) => H - 4 - ((e - min) / (max - min)) * (H - 18);
    const line = profile.distancesM.map((d, i) => `${x(d).toFixed(1)},${y(profile.elevationsM[i]).toFixed(1)}`).join(' L');
    const area = `M0,${H} L${line} L${W},${H} Z`;
    const top = profile.elevationsM.indexOf(max);
    const topD = profile.distancesM[top];
    const withWeather = points.filter((p): p is RouteWeatherPoint & { weather: NonNullable<RouteWeatherPoint['weather']> } => !!p.weather);
    const nearest = (d: number) =>
      withWeather.reduce<(typeof withWeather)[number] | null>((a, p) => (!a || Math.abs(p.distanceFromStartKm * 1000 - d) < Math.abs(a.distanceFromStartKm * 1000 - d) ? p : a), null);
    const stops = withWeather.map((p) => ({ at: Math.min(1, Math.max(0, (p.distanceFromStartKm * 1000) / total)), color: tempColor(p.weather.temperature) }));
    return { area, line: `M${line}`, x, y, min, max, topD, topPoint: nearest(topD), stops };
  }, [plan, profile, points]);

  if (!view) return null;
  const top = view.topPoint;
  const place = top?.placeName ? m.ui.near(top.placeName) : null;
  const summary = [
    `${Math.round(view.max)} ${m.units.m}`,
    place,
    top ? top.localTime : null,
    top?.weather ? `${formatTemp(top.weather.temperature, unit)} ${conditionText(top.weather, m).toLowerCase()}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const tx = view.x(view.topD);
  return (
    <section className="elev">
      <h3 className="label">{m.elevation.title}</h3>
      <p className="elev__summary">
        <strong>{m.elevation.highest}</strong> {summary}
      </p>
      <svg className="elev__chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${m.elevation.highest}: ${summary}`}>
        <defs>
          <linearGradient id={`t${gid}`} x1="0" x2="1" y1="0" y2="0">
            {view.stops.length ? view.stops.map((s, i) => <stop key={i} offset={s.at} stopColor={s.color} />) : <stop offset="0" stopColor="#8a929d" />}
          </linearGradient>
        </defs>
        <path d={view.area} fill={`url(#t${gid})`} opacity="0.55" />
        <path d={view.line} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <line x1={tx} x2={tx} y1={view.y(view.max)} y2={H} stroke="currentColor" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" opacity="0.6" />
        {progressM !== null ? <line x1={view.x(progressM)} x2={view.x(progressM)} y1="0" y2={H} className="elev__now" vectorEffect="non-scaling-stroke" /> : null}
      </svg>
      <div className="elev__axis tabular" aria-hidden="true">
        <span>
          {Math.round(view.min)}–{Math.round(view.max)} {m.units.m}
        </span>
        <span>{m.elevation.legend}</span>
      </div>
    </section>
  );
}
