import { beforeEach, describe, expect, it } from 'vitest';
import { clearDriveSession, readDriveSession, saveDriveSession } from './driveSession';

const BATUMI = { id: 'bat', name: 'Batumi', label: 'Batumi, Georgia', coordinate: [41.63, 41.64] as [number, number] };

describe('resume a drive after a reload (this tab only)', () => {
  beforeEach(() => sessionStorage.clear());

  it('keeps only the destination and the stops ahead, for 30 min', () => {
    saveDriveSession(BATUMI, [{ ...BATUMI, id: 'k', name: 'Kutaisi' }], 1_000_000);
    const s = readDriveSession(1_000_000 + 10 * 60_000);
    expect(s?.destination.name).toBe('Batumi');
    expect(s?.waypoints.map((w) => w.name)).toEqual(['Kutaisi']);
    expect(Object.keys(JSON.parse(sessionStorage.getItem('navweather.drive.v1')!))).toEqual(['destination', 'waypoints', 'savedAt', 'mode']); // never a position or a route
    expect(readDriveSession(1_000_000 + 31 * 60_000)).toBeNull();
    expect(sessionStorage.length).toBe(0); // expired → removed
  });

  it('remembers how the trip was being made, so a walk is resumed as a walk', () => {
    saveDriveSession(BATUMI, [], 1_000_000, 'walk');
    expect(readDriveSession(1_000_000 + 60_000)?.mode).toBe('walk');
    saveDriveSession(BATUMI, [], 1_000_000);
    expect(readDriveSession(1_000_000 + 60_000)?.mode).toBe('drive');
    // Only modes that can be followed turn by turn come back; anything else is a car trip.
    sessionStorage.setItem('navweather.drive.v1', JSON.stringify({ destination: BATUMI, waypoints: [], savedAt: 1_000_000, mode: 'flight' }));
    expect(readDriveSession(1_000_000 + 60_000)?.mode).toBe('drive');
  });

  it('rejects damaged data and clears on stop', () => {
    sessionStorage.setItem('navweather.drive.v1', JSON.stringify({ destination: { name: 'X', coordinate: [999, 1] }, savedAt: Date.now() }));
    expect(readDriveSession()).toBeNull();
    sessionStorage.setItem('navweather.drive.v1', '{oops');
    expect(readDriveSession()).toBeNull();
    saveDriveSession(BATUMI, []);
    clearDriveSession();
    expect(readDriveSession()).toBeNull();
  });
});
