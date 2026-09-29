import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportKind, Vote } from '../reports/protocol';
import { setProviders } from '../services/providers';
import type { Incident, IncidentProvider } from '../services/traffic/IncidentProvider';
import { installFakeProviders } from '../test/harness';
import type { LngLat } from '../types/geo';
import { useSettings } from './settings';
import { __resetStoreRuntime, useAppStore } from './store';

/** Driver reports end-to-end: fetched along the route, sent from the car, "still there?" after passing one. */

const BASE = Date.UTC(2026, 8, 26, 4, 0);
const initialState = useAppStore.getState();

class FakeReports implements IncidentProvider {
  readonly name = 'reports';
  list: Incident[] = [];
  fail = false;
  calls = 0;
  sent: { kind: ReportKind; coordinate: LngLat }[] = [];
  votes: { id: string; vote: Vote }[] = [];
  async getIncidents(): Promise<Incident[]> {
    this.calls++;
    if (this.fail) throw new Error('down');
    return this.list;
  }
  async report(kind: ReportKind, coordinate: LngLat) {
    this.sent.push({ kind, coordinate });
    return { id: `mine${this.sent.length}`.padEnd(16, '0'), expiresAt: Date.now() + 3_600_000 };
  }
  async vote(id: string, vote: Vote) {
    this.votes.push({ id, vote });
    return { active: vote !== 'gone' };
  }
}

let reports: FakeReports;

const along = (km: number): LngLat => {
  const t = useAppStore.getState().plan!.timed;
  let i = 0;
  while (i < t.cumDistM.length - 1 && t.cumDistM[i] < km * 1000) i++;
  return t.route.geometry[i];
};

function otherDriversReport(id: string, km: number, kind: Incident['kind'] = 'accident'): Incident {
  return { id: `report:${id}`, reportId: id, kind, coordinate: along(km), severity: 'high', verified: false, source: 'reports', reportedAt: Date.now(), expiresAt: Date.now() + 3_600_000, confirmations: 0 };
}

async function plan() {
  const s = useAppStore.getState();
  s.setOriginText('Tbilisi');
  s.setDestinationText('Batumi');
  useAppStore.setState({ departure: { mode: 'at', utcMs: BASE } });
  await useAppStore.getState().calculateRoute();
}

/** Drive (real GPS) from `fromKm` to `toKm` in 100 m steps at ~90 km/h. */
function driveGps(fromKm: number, toKm: number) {
  for (let km = fromKm; km <= toKm + 1e-9; km += 0.1) {
    vi.setSystemTime(Date.now() + 4000);
    useAppStore.getState().handlePosition({ coordinate: along(km), accuracyM: 8, speedMps: 25, timestampMs: Date.now() });
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(BASE - 10 * 60000);
  __resetStoreRuntime();
  useAppStore.setState(initialState, true);
  useSettings.getState().reset();
  const h = installFakeProviders(BASE);
  reports = new FakeReports();
  h.providers.incidents = reports;
});

afterEach(() => {
  vi.useRealTimers();
  setProviders(null);
});

describe('driver reports', () => {
  it('reports on the route are shown as unconfirmed events (never as fact)', async () => {
    await plan();
    // ~20 min into the drive: still there when we'd arrive (reports that lapse before then are dropped).
    reports.list = [otherDriversReport('aaaaaaaaaaaaaaaa', 30)];
    useAppStore.getState().refreshIncidents();
    await vi.waitFor(() => expect(useAppStore.getState().incidents).toHaveLength(1));
    const s = useAppStore.getState();
    expect(s.reportsStatus).toBe('ready');
    const ev = s.derived.intelligence.events.find((e) => e.id === 'INC@report:aaaaaaaaaaaaaaaa')!;
    expect(ev).toMatchObject({ type: 'INCIDENT', title: 'Accident', shortMessage: 'Unconfirmed report' });
    expect(ev.voiceMessage).toMatch(/^Accident reported ahead in/);
  });

  it('sends only from a real drive, at the car position, and shows the report at once', async () => {
    await plan();
    const planning = await useAppStore.getState().reportIncident('hazard', { notify: false });
    expect(planning.ok).toBe(false);

    useAppStore.getState().startSimulation();
    const simulated = await useAppStore.getState().reportIncident('hazard');
    expect(simulated.ok).toBe(false);
    expect(useAppStore.getState().notice?.text).toMatch(/simulated drive/i);
    useAppStore.getState().exitSimulation();
    expect(reports.sent).toHaveLength(0);

    useAppStore.getState().startNavigation();
    const noFixYet = await useAppStore.getState().reportIncident('hazard');
    expect(noFixYet.ok).toBe(false);
    driveGps(83, 84);
    const res = await useAppStore.getState().reportIncident('hazard');
    expect(res.ok).toBe(true);
    expect(reports.sent).toEqual([{ kind: 'hazard', coordinate: useAppStore.getState().vehicle!.coordinate }]);
    expect(useAppStore.getState().incidents.map((i) => i.id)).toContain('report:mine100000000000');
    expect(useAppStore.getState().notice).toMatchObject({ kind: 'success' });
  });

  it('offline, nothing is sent and the driver is told', async () => {
    await plan();
    useAppStore.getState().startNavigation();
    driveGps(83, 84);
    useAppStore.setState({ online: false });
    const res = await useAppStore.getState().reportIncident('accident');
    expect(res).toMatchObject({ ok: false, message: expect.stringMatching(/no connection/i) });
    expect(reports.sent).toHaveLength(0);
  });

  it('asks "still there?" once after passing another driver\'s report; "gone" takes it off the map', async () => {
    await plan();
    reports.list = [otherDriversReport('bbbbbbbbbbbbbbbb', 100)];
    useAppStore.getState().refreshIncidents();
    await vi.waitFor(() => expect(useAppStore.getState().incidents).toHaveLength(1));
    useAppStore.getState().startNavigation();
    driveGps(97, 99.8);
    expect(useAppStore.getState().reportPrompt).toBeNull();
    driveGps(99.9, 100.9);
    expect(useAppStore.getState().reportPrompt).toMatchObject({ reportId: 'bbbbbbbbbbbbbbbb', kind: 'accident' });

    useAppStore.getState().answerReportPrompt('gone');
    expect(reports.votes).toEqual([{ id: 'bbbbbbbbbbbbbbbb', vote: 'gone' }]);
    expect(useAppStore.getState().incidents).toHaveLength(0);
    driveGps(101, 101.5);
    expect(useAppStore.getState().reportPrompt).toBeNull();
  });

  it('never asks about your own report, nor during a simulation', async () => {
    await plan();
    useAppStore.getState().startNavigation();
    driveGps(119, 120);
    await useAppStore.getState().reportIncident('roadworks');
    driveGps(120.2, 121);
    expect(useAppStore.getState().reportPrompt).toBeNull();
    useAppStore.getState().stopNavigation();

    reports.list = [otherDriversReport('cccccccccccccccc', 40)];
    useAppStore.getState().refreshIncidents();
    await vi.waitFor(() => expect(useAppStore.getState().incidents.some((i) => i.reportId === 'cccccccccccccccc')).toBe(true));
    useAppStore.getState().startSimulation();
    useAppStore.getState().setSimulationSpeed(1);
    useAppStore.getState().simulationSkip(45 * 60); // well past km 40
    expect(useAppStore.getState().progress!.distanceAlongM).toBeGreaterThan(41_000);
    expect(useAppStore.getState().reportPrompt).toBeNull();
  });

  it('refreshes every few minutes while driving; an outage marks the source unavailable', async () => {
    await plan();
    await vi.waitFor(() => expect(reports.calls).toBe(1));
    useAppStore.getState().startNavigation();
    driveGps(83, 84);
    expect(reports.calls).toBe(1);
    reports.fail = true;
    vi.setSystemTime(Date.now() + 6 * 60_000);
    driveGps(84.2, 84.4);
    expect(reports.calls).toBe(2);
    await vi.waitFor(() => expect(useAppStore.getState().reportsStatus).toBe('unavailable'));
    // The drive goes on as before.
    expect(useAppStore.getState().mode).toBe('navigating');
  });

  it('turned off in Settings: nothing is fetched, asked or offered', async () => {
    useSettings.getState().update({ driverReports: false });
    await plan();
    reports.list = [otherDriversReport('dddddddddddddddd', 100)];
    useAppStore.getState().refreshIncidents();
    expect(reports.calls).toBe(0);
    expect(useAppStore.getState().incidents).toHaveLength(0);
  });

  it('closing the route forgets its reports, cameras and hazards', async () => {
    await plan();
    reports.list = [otherDriversReport('eeeeeeeeeeeeeeee', 100)];
    useAppStore.getState().refreshIncidents();
    await vi.waitFor(() => expect(useAppStore.getState().incidents).toHaveLength(1));
    useAppStore.setState({ speedCameras: [{ id: 'cam', coordinate: along(50), distanceAlongM: 50_000 }] as never });
    useAppStore.getState().clearRoute();
    const s = useAppStore.getState();
    expect(s.incidents).toEqual([]);
    expect(s.speedCameras).toEqual([]);
    expect(s.roadHazards).toEqual([]);
  });
});
