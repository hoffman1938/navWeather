import { describe, expect, it } from 'vitest';
import { zonedParts } from '../utils/timezone';
import { categoryOf, classifyTrip } from './classification/classify';
import { PACE_PRESETS, TRIP_THRESHOLDS } from './config';
import { createTripPlan } from './planning/planner';
import { buildSchedule } from './planning/schedule';
import { sanitizeTripRequest } from './protocol';
import { delaySeconds, dwellBetween, plannedTimeAt, progressStateFor } from './replanning/progress';
import { timeAtAlong } from './route/profile';
import { openStatus } from './stops/openingHours';
import { overpassQueryFor, parseOverpass } from './stops/places';
import { fakePlaces, profileOf, rawPlace, routeRequest, tbilisi, town, TZ, weatherEvery } from './test/fixtures';
import { hazardCode } from './weather/hazards';

const NOW = tbilisi(5, 7);
const localHour = (ms: number) => {
  const p = zonedParts(ms, TZ);
  return p.hour + p.minute / 60;
};
const tzAt = () => TZ;

function classify(distanceKm: number, kmh: number, departAtMs = tbilisi(5, 8)) {
  const req = routeRequest(distanceKm, kmh, { departAtMs });
  return classifyTrip({ profile: profileOf(req), departAtMs, tzAt, preferences: req.preferences, vehicle: req.vehicle });
}

describe('trip classification', () => {
  it('bands by distance, raised by driving time — thresholds come from one config', () => {
    expect(categoryOf(20, 25)).toBe('SHORT');
    expect(categoryOf(200, 150)).toBe('MEDIUM');
    expect(categoryOf(450, 300)).toBe('EXTENDED');
    expect(categoryOf(900, 440)).toBe('LONG'); // 900 km in 7 h 20 m: long by distance
    expect(categoryOf(720, 630)).toBe('LONG'); // 720 km in 10 h 30 m: long by time
    expect(categoryOf(300, 6 * 60)).toBe('EXTENDED'); // slow mountain road
    expect(categoryOf(799, 0, { ...TRIP_THRESHOLDS, LONG_TRIP_DISTANCE_KM: 700 })).toBe('LONG'); // configurable
  });

  it('a short local drive stays standard navigation', () => {
    const c = classify(20, 40);
    expect(c.category).toBe('SHORT');
    expect(c.longTripMode).toBe(false);
    expect(c.recommendedRestStops).toBe(0);
    expect(c.requiresOvernight).toBe(false);
  });

  it('Tbilisi → Batumi-like (360 km, ~5 h): a medium trip with a break, no Long Trip Mode', () => {
    const c = classify(360, 72);
    expect(c.category).toBe('EXTENDED'); // 5 h of driving
    expect(c.requiresOvernight).toBe(false);
    expect(c.longTripMode).toBe(false);
    expect(c.recommendedRestStops).toBeGreaterThanOrEqual(1);
  });

  it('800 km switches Long Trip Mode on by distance; 720 km at 10.5 h by time', () => {
    const a = classify(800, 90);
    expect(a.category).toBe('LONG');
    expect(a.longTripMode).toBe(true);
    expect(a.reasons).toContain('distance');
    const b = classify(720, 720 / 10.5);
    expect(b.reasons).toContain('driving-time');
    expect(b.longTripMode).toBe(true);
  });

  it('an overnight trip says so, and its total time includes the stops', () => {
    const c = classify(1580, 80);
    expect(c.requiresOvernight).toBe(true);
    expect(c.reasons).toContain('overnight');
    expect(c.estimatedTotalTimeMinutes).toBeGreaterThan(c.drivingTimeMinutes + 9 * 60);
    expect(c.requiresBorderCrossing).toBeNull(); // not determined yet — never guessed
  });
});

describe('schedule', () => {
  const run = (distanceKm: number, kmh: number, extra: Parameters<typeof buildSchedule>[0] extends infer P ? Partial<P> : never = {}) => {
    const req = routeRequest(distanceKm, kmh);
    return buildSchedule({ profile: profileOf(req), startAlongM: 0, startMs: req.departAtMs, tzAt, pace: PACE_PRESETS.balanced, vehicle: req.vehicle, ...extra });
  };

  it('breaks about every 2 h, lunch in the lunch window, nothing in the last half hour', () => {
    const s = run(600, 80); // 7.5 h from 08:00
    const breaks = s.stops.filter((x) => x.kinds.includes('rest') || x.kinds.includes('meal'));
    expect(breaks.length).toBeGreaterThanOrEqual(3);
    let last = 0;
    for (const b of breaks) {
      expect(b.driveTimeS - last).toBeLessThanOrEqual(PACE_PRESETS.balanced.restEveryS + 1);
      last = b.driveTimeS;
    }
    const lunch = s.stops.find((x) => x.kinds.includes('meal'))!;
    expect(localHour(lunch.arriveMs)).toBeGreaterThanOrEqual(11.5);
    expect(localHour(lunch.arriveMs)).toBeLessThan(14.5);
    expect(s.stops.every((x) => 7.5 * 3600 - x.driveTimeS > 30 * 60)).toBe(true);
  });

  it('multi-day: two nights at a balanced pace, one at a fast pace; mornings start at the preset hour', () => {
    const balanced = run(1580, 80);
    const nights = balanced.stops.filter((x) => x.kinds.includes('overnight'));
    expect(nights).toHaveLength(2);
    expect(balanced.days).toBe(3);
    for (const n of nights) {
      expect(localHour(n.arriveMs)).toBeLessThanOrEqual(22.01);
      expect(localHour(n.departMs)).toBeGreaterThanOrEqual(8);
      expect(n.departMs - n.arriveMs).toBeGreaterThanOrEqual(PACE_PRESETS.balanced.minOvernightS * 1000);
    }
    const req = routeRequest(1580, 80);
    const fast = buildSchedule({ profile: profileOf(req), startAlongM: 0, startMs: req.departAtMs, tzAt, pace: PACE_PRESETS.fast, vehicle: req.vehicle });
    expect(fast.stops.filter((x) => x.kinds.includes('overnight'))).toHaveLength(1);
  });

  it('leaving in the afternoon: the overnight comes by the latest arrival hour, not after the full daily driving', () => {
    const req = routeRequest(1200, 85, { departAtMs: tbilisi(5, 15) });
    const s = buildSchedule({ profile: profileOf(req), startAlongM: 0, startMs: req.departAtMs, tzAt, pace: PACE_PRESETS.balanced, vehicle: req.vehicle });
    const night = s.stops.find((x) => x.kinds.includes('overnight'))!;
    expect(night.why).toContain('latest-arrival');
    expect(localHour(night.arriveMs)).toBeLessThanOrEqual(22.01);
  });

  it('fuel only from a range the user gave: before the range runs out, then every full tank; EV charges', () => {
    expect(run(1000, 90).stops.some((x) => x.kinds.includes('fuel'))).toBe(false); // no range → never estimated
    const s = run(1000, 90, { vehicle: { kind: 'car', powertrain: 'fuel', rangeKm: 300, fullRangeKm: 600 }, rangeLeftKm: 300 });
    const fuel = s.stops.filter((x) => x.kinds.includes('fuel'));
    expect(fuel.length).toBeGreaterThanOrEqual(2);
    expect(fuel[0].alongM).toBeLessThanOrEqual(300_000 * 0.76);
    for (let i = 1; i < fuel.length; i++) expect(fuel[i].alongM - fuel[i - 1].alongM).toBeLessThanOrEqual(600_000);
    const ev = run(1000, 90, { vehicle: { kind: 'car', powertrain: 'ev', rangeKm: 250, fullRangeKm: 350 }, rangeLeftKm: 250 });
    expect(ev.stops.some((x) => x.kinds.includes('charge'))).toBe(true);
    expect(ev.stops.some((x) => x.kinds.includes('fuel'))).toBe(false);
    // Enough range for the whole trip: no stop forced.
    expect(run(300, 90, { vehicle: { kind: 'car', powertrain: 'fuel', rangeKm: 700 }, rangeLeftKm: 700 }).stops.some((x) => x.kinds.includes('fuel'))).toBe(false);
  });

  it('a stop due shortly after another is merged into it (one stop, not three)', () => {
    const s = run(800, 80, { vehicle: { kind: 'car', powertrain: 'fuel', rangeKm: 210, fullRangeKm: 600 }, rangeLeftKm: 210 });
    const first = s.stops[0];
    expect(first.kinds.length).toBeGreaterThan(1); // fuel at ~157 km (~2 h) joins the 2 h break
  });
});

describe('opening hours (safe subset)', () => {
  // weekday: 0 = Monday
  it('understands common forms and never guesses', () => {
    expect(openStatus('24/7', 3, 200)).toBe('open');
    expect(openStatus('Mo-Fr 08:00-20:00; Sa 09:00-14:00', 0, 9 * 60)).toBe('open');
    expect(openStatus('Mo-Fr 08:00-20:00; Sa 09:00-14:00', 5, 15 * 60)).toBe('closed');
    expect(openStatus('Mo-Fr 08:00-20:00; Sa 09:00-14:00', 6, 12 * 60)).toBe('closed'); // Sunday not listed
    expect(openStatus('18:00-02:00', 2, 60)).toBe('open'); // past midnight, from the previous day
    expect(openStatus('Mo-Su 10:00-22:00; Tu off', 1, 12 * 60)).toBe('closed');
    expect(openStatus('Mo-Fr 09:00-12:00,13:00-18:00', 2, 12 * 60 + 30)).toBe('closed');
    expect(openStatus('Mo-Sa 08:00-20:00; PH off', 0, 10 * 60)).toBe('open');
    expect(openStatus('sunrise-sunset', 0, 600)).toBe('unknown');
    expect(openStatus('Jan-Mar Mo 10:00-12:00', 0, 660)).toBe('unknown');
    expect(openStatus(undefined, 0, 0)).toBe('unknown');
  });
});

describe('weather hazard codes', () => {
  it('match the alert engine thresholds', () => {
    const base = { condition: 'CLEAR', precipitation: 0, temperature: 15, windGusts: 10, visibility: 20000 };
    expect(hazardCode(base)).toBe(0);
    expect(hazardCode({ ...base, condition: 'RAIN', precipitation: 1 })).toBe(1);
    expect(hazardCode({ ...base, condition: 'RAIN', precipitation: 5 })).toBe(2);
    expect(hazardCode({ ...base, condition: 'SNOW', temperature: -2, precipitation: 1 })).toBe(3);
    expect(hazardCode({ ...base, condition: 'THUNDERSTORM' })).toBe(4);
    expect(hazardCode({ ...base, condition: 'FOG', visibility: 300 })).toBe(5);
    expect(hazardCode({ ...base, windGusts: 80 })).toBe(6);
    expect(hazardCode({ ...base, condition: 'RAIN', precipitation: 1, temperature: 0 })).toBe(7);
    expect(hazardCode({ condition: null, precipitation: null, temperature: null, windGusts: null, visibility: null })).toBe(-1);
  });
});

describe('places (Overpass)', () => {
  it('one query per stop with fixed filters and radii; parsing keeps positions and categories', () => {
    const q = overpassQueryFor({ lat: 41.1, lon: 42.5, categories: [{ category: 'hotel', radiusKm: 10 }, { category: 'fuel', radiusKm: 2 }], vehicle: { kind: 'car', powertrain: 'fuel' } });
    expect(q).toContain('around:10000,41.10000,42.50000');
    expect(q).toContain('"tourism"~"^(hotel|motel|guest_house|hostel)$"');
    expect(q).toContain('around:2000');
    const truck = overpassQueryFor({ lat: 1, lon: 1, categories: [{ category: 'rest', radiusKm: 3 }], vehicle: { kind: 'truck', powertrain: 'fuel' } });
    expect(truck).toContain('"hgv"~"^(yes|designated)$"');
    const places = parseOverpass({
      elements: [
        { type: 'node', id: 1, lat: 41, lon: 42, tags: { tourism: 'hotel', name: 'H' } },
        { type: 'way', id: 2, center: { lat: 41, lon: 42 }, tags: { amenity: 'fuel' } },
        { type: 'way', id: 3, tags: { amenity: 'fuel' } }, // no position
        { type: 'node', id: 4, lat: 41, lon: 42, tags: { shop: 'bakery' } },
      ],
    });
    expect(places.map((p) => [p.id, p.category])).toEqual([['node/1', 'hotel'], ['way/2', 'fuel']]);
  });
});

describe('trip planner', () => {
  // Overnight target at a balanced pace: ~720 km (9 h). Trabzon (city, with hotels) is 1 h earlier; a village sits on the target.
  const cities = [town('Kutaisi', 230, 'city', 140_000), town('Hopa', 520, 'town'), town('Trabzon', 640, 'city', 800_000), town('Village', 715, 'village'), town('Samsun', 1000, 'city', 700_000), town('Ankara', 1340, 'city', 5_000_000)];

  it('a 1,580 km trip: days, overnights at towns with hotels, stops with reasons, a timeline that ends at the destination', async () => {
    const places = fakePlaces([
      rawPlace('n/1', 'hotel', 'hotel', 640, { tourism: 'hotel', name: 'Hotel Sea', stars: '4', parking: 'surface' }),
      rawPlace('n/2', 'hotel', 'guest_house', 641, { tourism: 'guest_house', name: 'Guest House' }),
      rawPlace('n/3', 'hotel', 'hotel', 1340, { tourism: 'hotel', name: 'Ankara Inn', stars: '3' }),
      rawPlace('n/4', 'hotel', 'hotel', 715, { tourism: 'hotel' }), // unnamed: never recommended
    ]);
    const req = routeRequest(1580, 80, { places: cities, includePlaces: true, preferences: { pace: 'balanced', hotelMinStars: 0, hotelMaxDetourKm: 10, food: 'any', fuelBrand: null } });
    const plan = await createTripPlan(req, { places, nowMs: NOW });
    expect(plan.classification.category).toBe('LONG');
    expect(plan.summary.overnights).toBe(2);
    expect(plan.days).toHaveLength(3);
    expect(plan.days[0].fromName).toBe('Start');
    expect(plan.days[2].toName).toBe('End');
    const night1 = plan.accommodation[0];
    expect(night1.areaName).toBe('Trabzon'); // a city with hotels inside the window, not the village at the bare 9 h point
    expect(night1.hotels.map((h) => h.name)).toEqual(['Hotel Sea', 'Guest House']);
    expect(night1.hotels[0].reasons).toEqual(expect.arrayContaining([{ code: 'stars', n: 4 }, { code: 'parking' }]));
    expect(night1.availability).toBe('not-checked');
    expect(plan.timeline[0].kind).toBe('depart');
    expect(plan.timeline.at(-1)!.kind).toBe('arrive');
    expect(plan.timeline.filter((e) => e.kind === 'continue')).toHaveLength(2);
    expect(plan.arriveAtMs).toBe(plan.timeline.at(-1)!.atMs);
    // Segments chain without gaps.
    for (let i = 1; i < plan.segments.length; i++) expect(plan.segments[i].fromM).toBe(plan.segments[i - 1].toM);
    expect(plan.dataStatus.places).toBe('ok');
  });

  it('respects the star wish and the detour limit', async () => {
    const places = fakePlaces([
      rawPlace('n/1', 'hotel', 'hotel', 640, { tourism: 'hotel', name: 'Two Star', stars: '2' }),
      rawPlace('n/2', 'hotel', 'hotel', 640, { tourism: 'hotel', name: 'Far Four', stars: '4' }, 8),
      rawPlace('n/3', 'hotel', 'hotel', 640, { tourism: 'hotel', name: 'Near Four', stars: '4' }),
    ]);
    const req = routeRequest(1580, 80, { places: cities, includePlaces: true, preferences: { pace: 'balanced', hotelMinStars: 3, hotelMaxDetourKm: 5, food: 'any', fuelBrand: null } });
    const plan = await createTripPlan(req, { places, nowMs: NOW });
    expect(plan.accommodation[0].hotels.map((h) => h.name)).toEqual(['Near Four']);
  });

  it('meal places closed at the planned arrival are left out; unknown hours are labelled', async () => {
    const places = fakePlaces([
      rawPlace('r/1', 'food', 'restaurant', 300, { amenity: 'restaurant', name: 'Closed Now', opening_hours: 'Mo-Su 18:00-23:00' }),
      rawPlace('r/2', 'food', 'restaurant', 300, { amenity: 'restaurant', name: 'Open Now', opening_hours: 'Mo-Su 10:00-22:00' }),
      rawPlace('r/3', 'food', 'cafe', 300, { amenity: 'cafe', name: 'Who Knows' }),
    ]);
    const req = routeRequest(600, 80, { includePlaces: true });
    const plan = await createTripPlan(req, { places, nowMs: NOW });
    const lunch = plan.recommendedStops.find((s) => s.kinds.includes('meal'))!;
    const food = lunch.places.find((p) => p.category === 'food')!;
    const names = food.places.map((p) => p.name);
    if (Math.abs(lunch.alongM - 300_000) < 3000) {
      expect(names).not.toContain('Closed Now');
      expect(food.places.find((p) => p.name === 'Who Knows')?.reasons).toContainEqual({ code: 'hours-unknown' });
    }
    expect(names).not.toContain('Closed Now');
  });

  it('places unavailable (API failure) or out of budget: the plan is still complete and says so', async () => {
    const req = routeRequest(1580, 80, { places: cities, includePlaces: true });
    const down = await createTripPlan(req, { places: fakePlaces([], { fail: true }), nowMs: NOW });
    expect(down.dataStatus.places).toBe('unavailable');
    expect(down.summary.overnights).toBe(2);
    expect(down.accommodation[0].status).toBe('unavailable');
    const tight = await createTripPlan(req, { places: fakePlaces([]), nowMs: NOW, maxPlaceQueries: 2 });
    expect(tight.dataStatus.places).toBe('partial');
    expect(tight.recommendedStops.some((s) => s.places.some((p) => p.status === 'skipped'))).toBe(true);
    const none = await createTripPlan({ ...req, includePlaces: false }, { places: fakePlaces([]), nowMs: NOW });
    expect(none.dataStatus.places).toBe('skipped');
  });

  it('no hotel near an overnight area → advice, never an invented hotel', async () => {
    const req = routeRequest(1580, 80, { places: cities, includePlaces: true });
    const plan = await createTripPlan(req, { places: fakePlaces([]), nowMs: NOW });
    expect(plan.accommodation[0].hotels).toEqual([]);
    expect(plan.accommodation[0].status).toBe('none-found');
    expect(plan.advice).toContainEqual(expect.objectContaining({ kind: 'no-places', category: 'hotel' }));
  });

  it('weather at the planned (stop-aware) times; heavy snow late on day 1 → suggest stopping earlier, with the reason', async () => {
    const t0 = tbilisi(5, 0);
    // Heavy snow between km 560 and 700 from 15:30 on day 1 to 03:00 on day 2; clear in the morning.
    const snowStart = tbilisi(5, 15, 30);
    const snowEnd = tbilisi(6, 3);
    const weather = weatherEvery(1580, 20, t0, (km, h) => (km >= 560 && km <= 700 && h >= snowStart && h < snowEnd ? 3 : 0));
    const req = routeRequest(1580, 80, { places: cities, weather });
    const plan = await createTripPlan(req, { places: null, nowMs: NOW });
    const snow = plan.weatherRisks.find((r) => r.kind === 'snow');
    expect(snow).toBeDefined();
    expect(snow!.severity).toBe('high');
    const advice = plan.advice.find((a) => a.kind === 'stop-earlier');
    expect(advice).toBeDefined();
    if (advice?.kind === 'stop-earlier') {
      expect(advice.alongM).toBeLessThan(560_000);
      expect(advice.areaName).toBe('Hopa');
      expect(advice.risk.kind).toBe('snow');
    }
    // The plan itself is not changed silently: the first night is still the planned one.
    expect(plan.accommodation[0].arriveMs).toBeGreaterThan(snowStart);
    expect(plan.timeline.some((e) => e.kind === 'weather' && e.hazard === 'snow')).toBe(true);
  });

  it('without forecasts the plan says the weather is missing instead of inventing it', async () => {
    const plan = await createTripPlan(routeRequest(900, 90), { nowMs: NOW });
    expect(plan.dataStatus.weather).toBe('missing');
    expect(plan.weatherRisks).toEqual([]);
    expect(plan.advice).toContainEqual({ kind: 'enter-range' });
  });
});

describe('replanning', () => {
  it('measures the delay and replans from the car with fewer stops left', async () => {
    const req = routeRequest(1580, 80);
    const plan = await createTripPlan(req, { nowMs: NOW });
    const profile = profileOf(req);
    const at = 400_000;
    const planned = plannedTimeAt(plan, at);
    expect(delaySeconds(plan, at, planned + 2 * 3600_000)).toBeCloseTo(7200, 0);
    const state = progressStateFor(plan, at, planned + 2 * 3600_000, (m) => timeAtAlong(profile, m));
    expect(state.drivenTodayS).toBeGreaterThan(4 * 3600);
    expect(state.sinceRestS).toBeLessThan(2.1 * 3600);
    const replanned = await createTripPlan({ ...req, progress: state }, { nowMs: NOW });
    expect(replanned.recommendedStops.every((s) => s.alongM >= at)).toBe(true);
    expect(replanned.timeline[0].kind).toBe('continue');
    // Two hours late: tonight's stop comes earlier on the road or later in the evening — the plan moved.
    const [before, after] = [plan.accommodation[0], replanned.accommodation[0]];
    const beforeStop = plan.recommendedStops.find((s) => s.id === before.stopId)!;
    const afterStop = replanned.recommendedStops.find((s) => s.id === after.stopId)!;
    expect(afterStop.alongM < beforeStop.alongM - 50_000 || after.arriveMs > before.arriveMs + 60 * 60_000).toBe(true);
    expect(replanned.arriveAtMs).toBeGreaterThanOrEqual(plan.arriveAtMs);
  });

  it('dwellBetween adds only stops strictly between two positions', async () => {
    const plan = await createTripPlan(routeRequest(1580, 80), { nowMs: NOW });
    const night = plan.recommendedStops.find((s) => s.kinds.includes('overnight'))!;
    expect(dwellBetween(plan, 0, night.alongM)).toBeLessThan(night.dwellMinutes * 60);
    expect(dwellBetween(plan, 0, night.alongM + 1000)).toBeGreaterThanOrEqual(night.dwellMinutes * 60);
    expect(dwellBetween(null, 0, 1e9)).toBe(0);
  });
});

describe('request validation', () => {
  it('accepts a good request and cleans it', () => {
    const req = routeRequest(500, 80, { places: [{ ...town('Gori‮', 70), name: 'Gori‮' }] });
    const ok = sanitizeTripRequest(JSON.parse(JSON.stringify(req)), NOW)!;
    expect(ok).not.toBeNull();
    expect(ok.places![0].name).toBe('Gori');
    expect(ok.vehicle).toEqual({ kind: 'car', powertrain: 'fuel' });
  });

  it('rejects malformed, oversized or out-of-range requests', () => {
    const req = routeRequest(500, 80);
    expect(sanitizeTripRequest(null, NOW)).toBeNull();
    expect(sanitizeTripRequest({ ...req, version: 2 }, NOW)).toBeNull();
    expect(sanitizeTripRequest({ ...req, departAtMs: NOW + 40 * 86400_000 }, NOW)).toBeNull();
    expect(sanitizeTripRequest({ ...req, route: { ...req.route, timesS: [0] } }, NOW)).toBeNull();
    expect(sanitizeTripRequest({ ...req, route: { ...req.route, polyline: 'bad\u0000' } }, NOW)).toBeNull();
    // Unknown preference values fall back to defaults instead of failing.
    const odd = sanitizeTripRequest({ ...req, preferences: { pace: 'reckless', hotelMinStars: 9, food: 'raw' }, vehicle: { kind: 'tank' } }, NOW)!;
    expect(odd.preferences.pace).toBe('balanced');
    expect(odd.preferences.hotelMinStars).toBe(0);
    expect(odd.vehicle.kind).toBe('car');
  });
});
