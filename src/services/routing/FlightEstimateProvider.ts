import type { LngLat } from '../../types/geo';
import type { Route } from '../../types/route';
import { bboxOf, haversineM } from '../../utils/distance';
import type { RouteRequest, RoutingCapabilities, RoutingProvider } from './RoutingProvider';

/** Average speed over the whole flight, and the fixed time for taxi, climb and approach. */
export const FLIGHT_CRUISE_KMH = 800;
export const FLIGHT_OVERHEAD_S = 25 * 60;

const DEG = Math.PI / 180;

/** Points along the great circle from a to b (inclusive), about every `stepM`. */
export function greatCircle(a: LngLat, b: LngLat, stepM = 25_000): LngLat[] {
  const distance = haversineM(a, b);
  const n = Math.max(1, Math.ceil(distance / stepM));
  const [lon1, lat1, lon2, lat2] = [a[0] * DEG, a[1] * DEG, b[0] * DEG, b[1] * DEG];
  const delta = distance / 6_371_008.8; // angular distance
  const out: LngLat[] = [];
  for (let i = 0; i <= n; i++) {
    if (i === 0) {
      out.push(a);
      continue;
    }
    if (i === n || delta === 0) {
      out.push(b);
      continue;
    }
    const f = i / n;
    const A = Math.sin((1 - f) * delta) / Math.sin(delta);
    const B = Math.sin(f * delta) / Math.sin(delta);
    const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
    const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
    const z = A * Math.sin(lat1) + B * Math.sin(lat2);
    out.push([Math.atan2(y, x) / DEG, Math.atan2(z, Math.hypot(x, y)) / DEG]);
  }
  return out;
}

/**
 * "Flight" is an ESTIMATE, not a booking: the straight line between the two
 * places and a typical time for it (25 min on the ground and in the climb,
 * then 800 km/h). It knows no airports, schedules or prices, and says so.
 */
export class FlightEstimateProvider implements RoutingProvider {
  readonly name = 'flight-estimate';
  readonly capabilities: RoutingCapabilities = { alternatives: false, avoid: [], laneGuidance: false, matrix: false, multiStop: false };

  async calculateRoutes(req: RouteRequest): Promise<Route[]> {
    const from = req.origin.coordinate;
    const to = req.destination.coordinate;
    const geometry = greatCircle(from, to);
    let distanceM = 0;
    for (let i = 1; i < geometry.length; i++) distanceM += haversineM(geometry[i - 1], geometry[i]);
    const durationS = FLIGHT_OVERHEAD_S + distanceM / (FLIGHT_CRUISE_KMH / 3.6);
    const last = geometry.length - 1;
    const step = (type: string, at: LngLat, fromIndex: number, toIndex: number, distance: number, duration: number) => ({
      distanceM: distance,
      durationS: duration,
      name: '',
      maneuverType: type,
      location: at,
      fromIndex,
      toIndex,
    });
    return [
      {
        id: `flight-${from.map((c) => c.toFixed(3)).join(',')}-${to.map((c) => c.toFixed(3)).join(',')}`,
        provider: this.name,
        origin: req.origin,
        destination: req.destination,
        geometry,
        distanceM,
        durationS,
        legs: [
          {
            distanceM,
            durationS,
            summary: '',
            steps: [step('depart', from, 0, last, distanceM, durationS), step('arrive', to, last, last, 0, 0)],
          },
        ],
        segments: [{ fromIndex: 0, toIndex: last, distanceM, durationS }],
        segmentSource: 'proportional',
        bbox: bboxOf(geometry),
        computedAt: Date.now(),
      },
    ];
  }
}
