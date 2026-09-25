import { memo } from 'react';
import type { ManeuverKind } from '../../navigation/maneuvers';

const ANGLE: Record<string, number> = {
  straight: 0,
  'slight right': 40,
  right: 90,
  'sharp right': 135,
  'slight left': -40,
  left: -90,
  'sharp left': -135,
};

function Arrow({ angle }: { angle: number }) {
  const rad = (angle * Math.PI) / 180;
  const len = 15;
  const tip: [number, number] = [24 + len * Math.sin(rad), 24 - len * Math.cos(rad)];
  const head = 7;
  const back = (a: number) => [tip[0] - head * Math.sin(rad + a), tip[1] + head * Math.cos(rad + a)];
  const [l, r] = [back(0.6), back(-0.6)];
  return (
    <>
      <path d={`M24 44 V24 L${tip[0]} ${tip[1]}`} fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      <path d={`M${tip[0]} ${tip[1]} L${l[0]} ${l[1]} M${tip[0]} ${tip[1]} L${r[0]} ${r[1]}`} stroke="currentColor" strokeWidth={5} strokeLinecap="round" />
    </>
  );
}

interface Props {
  kind: ManeuverKind;
  modifier?: string;
  exit?: number;
  size?: number;
  drivingSide?: 'left' | 'right';
}

/** Maneuver glyph derived from the maneuver model (type + angle), not a fixed image set. */
export const ManeuverIcon = memo(function ManeuverIcon({ kind, modifier = 'straight', size = 48 }: Props) {
  let body: React.ReactNode;
  if (kind === 'arrive') {
    body = (
      <>
        <path d="M24 44 V10" stroke="currentColor" strokeWidth={4} strokeLinecap="round" />
        <path d="M24 10 H38 L34 16 L38 22 H24 Z" fill="currentColor" />
      </>
    );
  } else if (kind === 'roundabout' || kind === 'rotary' || kind === 'roundabout-turn') {
    const a = ((ANGLE[modifier] ?? 0) * Math.PI) / 180;
    const ex = [24 + 18 * Math.sin(a), 20 - 18 * Math.cos(a)];
    const edge = [24 + 8 * Math.sin(a), 20 - 8 * Math.cos(a)];
    body = (
      <>
        <circle cx={24} cy={20} r={8} fill="none" stroke="currentColor" strokeWidth={4} />
        <path d="M24 44 V28" stroke="currentColor" strokeWidth={5} strokeLinecap="round" />
        <path d={`M${edge[0]} ${edge[1]} L${ex[0]} ${ex[1]}`} stroke="currentColor" strokeWidth={5} strokeLinecap="round" />
      </>
    );
  } else if (modifier === 'uturn') {
    body = (
      <>
        <path d="M30 44 V20 a7 7 0 0 0 -14 0 V32" fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" />
        <path d="M16 34 L11 27 M16 34 L21 27" stroke="currentColor" strokeWidth={5} strokeLinecap="round" />
      </>
    );
  } else if (kind === 'fork' || kind === 'off-ramp' || kind === 'on-ramp' || kind === 'merge') {
    const take = ANGLE[modifier] ?? 0;
    const other = take >= 0 ? -35 : 35;
    body = (
      <>
        <g opacity={0.35}>
          <Arrow angle={take === 0 ? 35 : other} />
        </g>
        <Arrow angle={take === 0 ? 0 : take > 0 ? 35 : -35} />
      </>
    );
  } else {
    body = <Arrow angle={ANGLE[modifier] ?? 0} />;
  }
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" focusable="false">
      {body}
    </svg>
  );
});

const LANE_ANGLE: Record<string, number> = {
  straight: 0,
  none: 0,
  'slight right': 35,
  right: 80,
  'sharp right': 120,
  'slight left': -35,
  left: -80,
  'sharp left': -120,
};

/** One lane arrow from its indications (real OSM turn:lanes data). */
export function LaneArrow({ indications, active, size = 28 }: { indications: string[]; active: boolean; size?: number }) {
  const main = indications.find((i) => i !== 'none') ?? 'straight';
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" focusable="false" style={{ opacity: active ? 1 : 0.35 }}>
      {main === 'uturn' ? (
        <>
          <path d="M30 44 V20 a7 7 0 0 0 -14 0 V32" fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" />
          <path d="M16 34 L11 27 M16 34 L21 27" stroke="currentColor" strokeWidth={5} strokeLinecap="round" />
        </>
      ) : (
        <Arrow angle={LANE_ANGLE[main] ?? 0} />
      )}
    </svg>
  );
}
