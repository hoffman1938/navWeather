import { memo } from 'react';
import type { WeatherCondition } from '../../types/weather';

interface Props {
  condition: WeatherCondition;
  isDay?: boolean;
  size?: number;
  className?: string;
  title?: string;
}

const CLOUD = 'M9.6 24h13.2a5.6 5.6 0 0 0 .7-11.16A7.6 7.6 0 0 0 8.9 14.3 4.9 4.9 0 0 0 9.6 24z';

function Sun({ cx = 16, cy = 16, r = 5.5 }: { cx?: number; cy?: number; r?: number }) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4;
    const r1 = r + 2.6;
    const r2 = r + 5;
    return (
      <line
        key={i}
        x1={cx + r1 * Math.cos(a)}
        y1={cy + r1 * Math.sin(a)}
        x2={cx + r2 * Math.cos(a)}
        y2={cy + r2 * Math.sin(a)}
      />
    );
  });
  return (
    <g>
      <g stroke="var(--sun)" strokeWidth={2} strokeLinecap="round">
        {rays}
      </g>
      <circle cx={cx} cy={cy} r={r} fill="var(--sun)" />
    </g>
  );
}

function Moon({ cx = 16, cy = 15, r = 7 }: { cx?: number; cy?: number; r?: number }) {
  return (
    <path
      d={`M${cx + r * 0.35} ${cy - r} a${r} ${r} 0 1 0 ${r * 0.95} ${r * 1.35} a${r * 0.78} ${r * 0.78} 0 0 1 -${r * 0.95} -${r * 1.35}z`}
      fill="var(--moon)"
    />
  );
}

function Drops({ n = 3, color = 'var(--rain)' }: { n?: number; color?: string }) {
  const xs = n === 2 ? [13, 19] : n === 4 ? [10, 14.5, 19, 23.5] : [11.5, 16.5, 21.5];
  return (
    <g stroke={color} strokeWidth={2} strokeLinecap="round">
      {xs.map((x) => (
        <line key={x} x1={x} y1={26} x2={x - 1.3} y2={29.5} />
      ))}
    </g>
  );
}

function Flakes({ xs = [11.5, 16.5, 21.5] }: { xs?: number[] }) {
  return (
    <g fill="var(--snow)">
      {xs.map((x, i) => (
        <circle key={x} cx={x} cy={i % 2 ? 29 : 27} r={1.5} />
      ))}
    </g>
  );
}

/** Multicolor condition icon (normalized conditions only). */
export const WeatherIcon = memo(function WeatherIcon({ condition, isDay = true, size = 32, className, title }: Props) {
  let content: React.ReactNode;
  switch (condition) {
    case 'CLEAR':
      content = isDay ? <Sun /> : <Moon cx={14} cy={16} r={8} />;
      break;
    case 'PARTLY_CLOUDY':
      content = (
        <>
          {isDay ? <Sun cx={12} cy={11} r={4.5} /> : <Moon cx={11} cy={10} r={5.5} />}
          <path d={CLOUD} transform="translate(3 3) scale(0.9)" fill="var(--cloud)" />
        </>
      );
      break;
    case 'CLOUDY':
      content = (
        <>
          <path d={CLOUD} transform="translate(5 -3) scale(0.75)" fill="var(--cloud-dark)" opacity={0.7} />
          <path d={CLOUD} fill="var(--cloud)" />
        </>
      );
      break;
    case 'FOG':
      content = (
        <>
          <path d={CLOUD} transform="translate(0 -4)" fill="var(--cloud)" />
          <g stroke="var(--fog)" strokeWidth={2} strokeLinecap="round">
            <line x1={7} y1={24} x2={25} y2={24} />
            <line x1={9} y1={28} x2={23} y2={28} />
          </g>
        </>
      );
      break;
    case 'RAIN':
      content = (
        <>
          <path d={CLOUD} transform="translate(0 -3)" fill="var(--cloud)" />
          <Drops />
        </>
      );
      break;
    case 'HEAVY_RAIN':
      content = (
        <>
          <path d={CLOUD} transform="translate(0 -3)" fill="var(--cloud-dark)" />
          <Drops n={4} />
        </>
      );
      break;
    case 'SNOW':
      content = (
        <>
          <path d={CLOUD} transform="translate(0 -3)" fill="var(--cloud)" />
          <Flakes />
        </>
      );
      break;
    case 'SLEET':
      content = (
        <>
          <path d={CLOUD} transform="translate(0 -3)" fill="var(--cloud)" />
          <Drops n={2} />
          <Flakes xs={[16.5]} />
        </>
      );
      break;
    case 'THUNDERSTORM':
      content = (
        <>
          <path d={CLOUD} transform="translate(0 -4)" fill="var(--cloud-dark)" />
          <path d="M17.5 19.5l-4 6h3.2l-1.7 5 5-6.8h-3.3l1.8-4.2z" fill="var(--sun)" />
        </>
      );
      break;
  }
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {content}
    </svg>
  );
});
