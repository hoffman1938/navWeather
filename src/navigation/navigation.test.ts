import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { ru } from '../i18n/ru';
import { tbilisiBatumiRoute } from '../test/helpers';
import { buildTimedRoute } from '../algorithms/routeTiming';
import { buildManeuvers, computeGuidance, type Maneuver } from './maneuvers';
import {
  announcementStage,
  dueManeuverPrompt,
  instructionText,
  markSpoken,
  navigationZoom,
  roadLabel,
  spokenPrompt,
  spokenRoad,
} from './instructions';

const timed = buildTimedRoute(tbilisiBatumiRoute());
const maneuvers = buildManeuvers(timed);

describe('maneuvers from the route model', () => {
  it('normalizes every OSRM step with its along-route position', () => {
    expect(maneuvers.length).toBe(timed.route.legs[0].steps.length);
    expect(maneuvers[0].kind).toBe('depart');
    expect(maneuvers.at(-1)!.kind).toBe('arrive');
    expect(maneuvers.at(-1)!.final).toBe(true);
    for (let i = 1; i < maneuvers.length; i++) {
      expect(maneuvers[i].distanceAlongM).toBeGreaterThanOrEqual(maneuvers[i - 1].distanceAlongM);
    }
    expect(maneuvers.at(-1)!.distanceAlongM).toBeCloseTo(timed.totalDistM, -2);
  });

  it('keeps roundabout exits and skips non-maneuvers', () => {
    const rb = maneuvers.find((m) => m.kind === 'roundabout' && m.exit);
    expect(rb?.exit).toBeGreaterThan(0);
    expect(maneuvers.filter((m) => m.kind === 'new-name').every((m) => !m.announce)).toBe(true);
    expect(maneuvers.find((m) => m.kind === 'depart')!.announce).toBe(false);
  });
});

describe('instructions (generated, localized)', () => {
  const mv = (over: Partial<Maneuver>): Maneuver => ({
    id: 'x',
    index: 0,
    kind: 'turn',
    location: [0, 0],
    distanceAlongM: 0,
    approachM: 3000,
    legIndex: 0,
    final: false,
    announce: true,
    ...over,
  });

  it.each([
    [{ kind: 'turn', modifier: 'right', roadName: 'Rustaveli Ave' }, 'Turn right onto Rustaveli Ave'],
    [{ kind: 'turn', modifier: 'slight left' }, 'Bear left'],
    [{ kind: 'turn', modifier: 'uturn' }, 'Make a U-turn'],
    [{ kind: 'fork', modifier: 'slight left', destinations: 'Kutaisi, Batumi' }, 'Keep left at the fork toward Kutaisi'],
    [{ kind: 'roundabout', exit: 2, roadRef: 'S 12' }, 'At the roundabout, take the second exit onto S 12'],
    [{ kind: 'off-ramp', modifier: 'slight right', destinations: 'Poti' }, 'Take the exit on the right toward Poti'],
    [{ kind: 'arrive', final: true, modifier: 'right' }, 'Your destination is on the right'],
    [{ kind: 'end-of-road', modifier: 'left' }, 'At the end of the road, turn left'],
  ] as [Partial<Maneuver>, string][])('%o → %s', (over, text) => {
    expect(instructionText(mv(over), en)).toBe(text);
  });

  it('localizes to Russian from the same maneuver', () => {
    const m = mv({ kind: 'turn', modifier: 'right', roadRef: 'S1' });
    expect(instructionText(m, ru)).toBe('Поверните направо на S1');
  });

  it('voice skips road names the voice cannot pronounce, preferring refs', () => {
    expect(spokenRoad('თავისუფლების მოედანი', undefined, en)).toBeUndefined();
    expect(spokenRoad('თბილისი — სენაკი — ლესელიძე', 'S1', en)).toBe('S1');
    expect(roadLabel('თბილისი — სენაკი — ლესელიძე', 'ს 1')).toBe('ს 1');
    expect(roadLabel('Rustaveli Ave', 'S1')).toBe('Rustaveli Ave (S1)');
  });

  it('spoken prompts: "In 500 meters, turn right." then "Turn right."', () => {
    const m = mv({ kind: 'turn', modifier: 'right' });
    expect(spokenPrompt(m, 'prepare', 480, en, 'metric')).toBe('In 500 meters, turn right.');
    expect(spokenPrompt(m, 'early', 1600, en, 'metric')).toBe('In 1.5 kilometers, turn right.');
    expect(spokenPrompt(m, 'final', 40, en, 'metric')).toBe('Turn right.');
    expect(spokenPrompt(m, 'prepare', 480, en, 'imperial')).toBe('In a quarter mile, turn right.');
    expect(spokenPrompt(m, 'prepare', 300, ru, 'metric')).toBe('Через 300 метров поверните направо.');
  });

  it('chains a close follow-up maneuver', () => {
    const a = mv({ kind: 'turn', modifier: 'right' });
    const b = mv({ kind: 'turn', modifier: 'left' });
    expect(spokenPrompt(a, 'final', 30, en, 'metric', b)).toBe('Turn right, then turn left.');
  });
});

describe('announcement timing', () => {
  it('scales with speed and skips "early" on short approaches', () => {
    expect(announcementStage(2000, 30, 10_000)).toBe('early'); // highway
    expect(announcementStage(2000, 12, 10_000)).toBe(null); // city: too far yet
    expect(announcementStage(400, 12, 10_000)).toBe('early'); // ~33 s at city speed
    expect(announcementStage(200, 12, 10_000)).toBe('prepare');
    expect(announcementStage(50, 12, 10_000)).toBe('final');
    expect(announcementStage(1500, 30, 1600)).toBe(null); // short approach: no early prompt
  });

  it('speaks each stage once and never an earlier stage after a later one', () => {
    const m = maneuvers.find((x) => x.announce && x.approachM > 5000)!;
    const spoken = new Set<string>();
    expect(dueManeuverPrompt(m, 1800, 30, spoken)).toBe('early');
    markSpoken(m, 'early', spoken);
    expect(dueManeuverPrompt(m, 1700, 30, spoken)).toBe(null);
    expect(dueManeuverPrompt(m, 100, 30, spoken)).toBe('final'); // jumped past "prepare"
    markSpoken(m, 'final', spoken);
    expect(dueManeuverPrompt(m, 400, 30, spoken)).toBe(null);
  });

  it('guidance finds the next maneuver and the current road', () => {
    const g = computeGuidance(maneuvers, timed, 100_000);
    expect(g.next).not.toBeNull();
    expect(g.next!.distanceAlongM).toBeGreaterThan(100_000);
    expect(g.distanceToNextM).toBeCloseTo(g.next!.distanceAlongM - 100_000, 3);
    expect(g.timeToNextS).toBeGreaterThan(0);
    expect(g.currentRoadRef ?? g.currentRoadName).toBeTruthy();
  });

  it('auto-zoom: out on open road, in approaching a maneuver', () => {
    expect(navigationZoom(5000, 30)).toBeLessThan(navigationZoom(150, 30));
    expect(navigationZoom(null, 10)).toBeGreaterThan(navigationZoom(null, 30));
  });
});
