import { describe, expect, it } from 'vitest';
import { snapIncidentsToRoute } from '../algorithms/incidents';
import { buildTimedRoute, positionAtDistance } from '../algorithms/routeTiming';
import { en } from '../i18n/en';
import type { Incident } from '../services/traffic/IncidentProvider';
import { tbilisiBatumiRoute } from '../test/helpers';
import { evaluateDriverAlerts, initialDriverAlertState } from './driverAlerts';
import { buildRouteIntelligence } from './routeIntelligence';

const timed = buildTimedRoute(tbilisiBatumiRoute());
const DEP = Date.UTC(2026, 8, 27, 5);
const at = (km: number) => positionAtDistance(timed, km * 1000).coordinate;

function incident(p: Partial<Incident> & Pick<Incident, 'id' | 'coordinate'>): Incident {
  return { kind: 'accident', severity: 'high', verified: true, source: 'Test feed', reportedAt: DEP, ...p };
}

function intel(incidents: Incident[], progressKm = 0) {
  return buildRouteIntelligence({
    timed,
    maneuvers: [],
    progressM: progressKm * 1000,
    clock: { mode: 'planning', departureMs: DEP },
    weatherPoints: [],
    currentPoint: null,
    weatherPrefs: { level: 'all', types: { rain: true, snow: true, fog: true, wind: true, temperature: true } },
    speedLimits: null,
    fuelRangeKm: null,
    incidents: snapIncidentsToRoute(incidents, timed),
    m: en,
    units: { distance: 'metric', temperature: 'c', wind: 'kmh' },
  });
}

describe('incidents on the route', () => {
  it('keeps only incidents on the road, placed by distance', () => {
    const off: [number, number] = [at(100)[0], at(100)[1] + 0.02]; // ~2 km off the road
    const snapped = snapIncidentsToRoute([incident({ id: 'a', coordinate: at(150) }), incident({ id: 'b', coordinate: off })], timed);
    expect(snapped.map((i) => i.id)).toEqual(['a']);
    expect(snapped[0].distanceAlongM).toBeGreaterThan(145_000);
    expect(snapped[0].distanceAlongM).toBeLessThan(155_000);
  });

  it('confirmed incidents become events with time-based wording; reports say "reported"', () => {
    const r = intel([
      incident({ id: 'crash', coordinate: at(60) }),
      incident({ id: 'debris', kind: 'hazard', severity: 'medium', verified: false, source: 'Driver reports', coordinate: at(90) }),
    ]);
    const crash = r.events.find((e) => e.id === 'INC@crash')!;
    expect(crash).toMatchObject({ type: 'INCIDENT', category: 'incident', severity: 'high', title: 'Accident', shortMessage: 'Test feed' });
    expect(crash.voiceMessage).toMatch(/^Accident ahead in about \d+ minutes\.$/);
    const debris = r.events.find((e) => e.id === 'INC@debris')!;
    expect(debris.shortMessage).toBe('Unconfirmed report');
    expect(debris.voiceMessage).toMatch(/^Hazard on the road reported ahead in about/);
    expect(debris.confidence).toBeLessThan(crash.confidence);
  });

  it('drops incidents already passed or cleared before we get there', () => {
    const r = intel(
      [
        incident({ id: 'behind', coordinate: at(20) }),
        incident({ id: 'cleared', coordinate: at(200), expiresAt: DEP + 30 * 60_000 }),
        incident({ id: 'closure', kind: 'closure', severity: 'critical', coordinate: at(200), expiresAt: DEP + 10 * 3_600_000 }),
      ],
      50,
    );
    expect(r.events.filter((e) => e.type === 'INCIDENT').map((e) => e.id)).toEqual(['INC@closure']);
  });

  it('a critical closure is announced by the alert engine', () => {
    const r = intel([incident({ id: 'closure', kind: 'closure', severity: 'critical', coordinate: at(30) })]);
    const d = evaluateDriverAlerts(r.events, initialDriverAlertState, { nowMs: DEP, prefs: { output: 'both', timing: 'auto' }, m: en });
    expect(d.voice.map((v) => v.text).join(' ')).toMatch(/Road closed ahead/);
  });
});
