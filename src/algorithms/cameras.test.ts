import { describe, expect, it } from 'vitest';
import { buildTimedRoute, positionAtDistance } from './routeTiming';
import { tbilisiBatumiRoute } from '../test/helpers';
import { dueCamera, snapCamerasToRoute } from './cameras';

const timed = buildTimedRoute(tbilisiBatumiRoute());
const at = (km: number) => positionAtDistance(timed, km * 1000).coordinate;

describe('speed cameras (OSM, opt-in)', () => {
  it('keeps cameras on the road, in driving order', () => {
    const off: [number, number] = [at(50)[0], at(50)[1] + 0.01]; // ~1 km off the road
    const cams = snapCamerasToRoute(
      [
        { id: 'b', coordinate: at(120), kmh: 90 },
        { id: 'a', coordinate: at(40) },
        { id: 'x', coordinate: off },
      ],
      timed,
    );
    expect(cams.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('announces each camera once, ~600 m (or 25 s) ahead', () => {
    const cams = snapCamerasToRoute([{ id: 'a', coordinate: at(40), kmh: 90 }], timed);
    const done = new Set<string>();
    expect(dueCamera(cams, 38_000, 25, done)).toBeNull(); // 2 km away
    expect(dueCamera(cams, 39_500, 25, done)?.id).toBe('a'); // ~500 m
    done.add('a');
    expect(dueCamera(cams, 39_800, 25, done)).toBeNull();
    // Fast driving widens the window: 35 m/s × 25 s = 875 m.
    expect(dueCamera(cams, 39_200, 35, new Set())?.id).toBe('a');
  });
});
