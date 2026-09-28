import { en, type Messages } from '../i18n/en';
import { formatTemp, type TemperatureUnit } from '../i18n/format';
import type {
  RouteWeatherPoint,
  RouteWeatherSummary,
  WeatherAtTime,
  WeatherCondition,
  WeatherGroup,
  WeatherGroupClass,
  WeatherRouteSegment,
} from '../types/weather';
import { HOUR_MS, MINUTE_MS } from '../utils/time';
import { isPrecipitating } from './weatherMatching';

type WithWeather = RouteWeatherPoint & { weather: WeatherAtTime };

const hasWeather = (p: RouteWeatherPoint): p is WithWeather => p.weather !== null;

export function groupClassOf(condition: WeatherCondition): WeatherGroupClass {
  switch (condition) {
    case 'CLEAR':
    case 'PARTLY_CLOUDY':
      return 'clear';
    case 'CLOUDY':
      return 'cloudy';
    case 'FOG':
      return 'fog';
    case 'RAIN':
      return 'rain';
    case 'HEAVY_RAIN':
      return 'heavy-rain';
    case 'SNOW':
      return 'snow';
    case 'SLEET':
      return 'sleet';
    case 'THUNDERSTORM':
      return 'thunderstorm';
  }
}

const SEVERITY: Record<WeatherGroupClass, number> = {
  clear: 0,
  cloudy: 1,
  fog: 2,
  rain: 3,
  'heavy-rain': 4,
  sleet: 5,
  snow: 5,
  thunderstorm: 6,
};

export function isNotableClass(c: WeatherGroupClass): boolean {
  return SEVERITY[c] >= 2;
}

/** Hedged, forecast-style wording — never "guaranteed". */
export function groupLabel(groupClass: WeatherGroupClass, points: WeatherAtTime[], m: Messages = en): string {
  const maxProb = Math.max(0, ...points.map((w) => w.precipitationProbability ?? 0));
  const g = m.weather.group;
  switch (groupClass) {
    case 'clear':
      return points.every((w) => w.condition === 'CLEAR') ? g.clear : g.mostlyClear;
    case 'cloudy':
      return g.cloudy;
    case 'fog':
      return g.fog;
    case 'rain':
      return maxProb >= 60 ? g.rainLikely : maxProb >= 30 ? g.rainPossible : g.lightRainPossible;
    case 'heavy-rain':
      return g.heavyRain;
    case 'snow':
      return maxProb >= 60 ? g.snowLikely : g.snowPossible;
    case 'sleet':
      return g.sleet;
    case 'thunderstorm':
      return g.thunderstorm;
  }
}

/** The condition to show for a group: its most severe member. */
function dominantCondition(points: WeatherAtTime[]): WeatherCondition {
  const order: WeatherCondition[] = [
    'THUNDERSTORM',
    'SNOW',
    'SLEET',
    'HEAVY_RAIN',
    'RAIN',
    'FOG',
    'CLOUDY',
    'PARTLY_CLOUDY',
    'CLEAR',
  ];
  for (const c of order) if (points.some((w) => w.condition === c)) return c;
  return 'CLOUDY';
}

/**
 * Consecutive points with the same weather class form one group
 * ("Gori → Khashuri: Rain likely"). A lone clear/cloudy point sandwiched
 * between two groups of the same class is absorbed to avoid flicker;
 * notable weather (rain, fog, snow…) is never absorbed.
 */
export function groupWeather(points: RouteWeatherPoint[], m: Messages = en): WeatherGroup[] {
  const pts = points.filter(hasWeather);
  const runs: WithWeather[][] = [];
  for (const p of pts) {
    const cls = groupClassOf(p.weather.condition);
    const last = runs[runs.length - 1];
    if (last && groupClassOf(last[0].weather.condition) === cls) last.push(p);
    else runs.push([p]);
  }
  // Absorb single-point non-notable blips.
  for (let i = 1; i < runs.length - 1; i++) {
    const cls = groupClassOf(runs[i][0].weather.condition);
    const prevCls = groupClassOf(runs[i - 1][0].weather.condition);
    const nextCls = groupClassOf(runs[i + 1][0].weather.condition);
    if (runs[i].length === 1 && !isNotableClass(cls) && prevCls === nextCls && !isNotableClass(prevCls)) {
      runs.splice(i - 1, 3, [...runs[i - 1], ...runs[i], ...runs[i + 1]]);
      i--;
    }
  }
  return runs.map((run) => {
    const ws = run.map((p) => p.weather);
    const first = run[0];
    const last = run[run.length - 1];
    const temps = ws.map((w) => w.temperature);
    const cls = groupClassOf(dominantCondition(ws));
    return {
      id: `g-${first.id}`,
      groupClass: cls,
      condition: dominantCondition(ws),
      label: groupLabel(cls, ws, m),
      fromPointId: first.id,
      toPointId: last.id,
      fromName: first.placeName,
      toName: last.placeName,
      startDistanceM: first.distanceFromStartKm * 1000,
      endDistanceM: last.distanceFromStartKm * 1000,
      startArrivalMs: first.arrivalMs,
      endArrivalMs: last.arrivalMs,
      maxPrecipitationProbability: Math.max(0, ...ws.map((w) => w.precipitationProbability ?? 0)),
      minTemperature: Math.min(...temps),
      maxTemperature: Math.max(...temps),
      pointIds: run.map((p) => p.id),
    };
  });
}

/**
 * Pick the handful of points worth a card/marker: the ends, weather
 * transitions and events, named settlements — spread out in time. Avoids 30
 * identical cards when the weather does not change for 200 km.
 */
export function selectDisplayPoints(
  points: RouteWeatherPoint[],
  options: { includeFirst?: boolean; maxCards?: number; eventPointIds?: Set<string> } = {},
): RouteWeatherPoint[] {
  const pts = points;
  if (pts.length <= 2) return pts;
  const includeFirst = options.includeFirst ?? true;
  const spanMs = pts[pts.length - 1].arrivalMs - pts[0].arrivalMs;
  const hours = spanMs / HOUR_MS;
  const maxCards = options.maxCards ?? Math.max(4, Math.min(14, Math.round(2 + hours * 1.5)));
  if (pts.length <= maxCards) return pts;

  const groups = groupWeather(pts);
  const groupStarts = new Set(groups.map((g) => g.fromPointId));
  const groupEnds = new Set(groups.map((g) => g.toPointId));
  const eventPoints = options.eventPointIds ?? new Set<string>();

  const score = (p: RouteWeatherPoint, i: number): number => {
    if (i === pts.length - 1 || (includeFirst && i === 0)) return Infinity;
    let s = 1;
    if (eventPoints.has(p.id)) s += 80;
    if (groupStarts.has(p.id)) s += 50;
    if (groupEnds.has(p.id)) s += 20;
    if (p.placeName && p.placeRelation === 'in') s += p.reasons.includes('settlement') ? 40 : 25;
    else if (p.placeName) s += 8;
    if (p.reasons.includes('elevation')) s += 20;
    if (p.weather && isPrecipitating(p.weather.condition)) s += 10;
    return s;
  };

  const minGap = Math.max(10 * MINUTE_MS, spanMs / (maxCards * 1.6));
  const ranked = pts.map((p, i) => ({ p, i, s: score(p, i) })).sort((a, b) => b.s - a.s);
  const chosen: typeof ranked = [];
  for (const c of ranked) {
    if (chosen.length >= maxCards) break;
    const required = c.s === Infinity;
    const gapNeeded = c.s >= 80 ? minGap / 3 : minGap;
    const ok = required || chosen.every((x) => Math.abs(x.p.arrivalMs - c.p.arrivalMs) >= gapNeeded);
    if (ok) chosen.push(c);
  }

  // Never leave a long stretch without a card.
  const maxGap = Math.max(75 * MINUTE_MS, (spanMs / Math.max(1, maxCards - 1)) * 1.8);
  chosen.sort((a, b) => a.i - b.i);
  for (let k = 0; k < chosen.length - 1; k++) {
    const a = chosen[k];
    const b = chosen[k + 1];
    if (b.p.arrivalMs - a.p.arrivalMs <= maxGap) continue;
    const mid = (a.p.arrivalMs + b.p.arrivalMs) / 2;
    let best: (typeof ranked)[number] | undefined;
    for (const c of ranked) {
      if (c.i <= a.i || c.i >= b.i) continue;
      const val = c.s - Math.abs(c.p.arrivalMs - mid) / (30 * MINUTE_MS);
      if (!best || val > best.s - Math.abs(best.p.arrivalMs - mid) / (30 * MINUTE_MS)) best = c;
    }
    if (best) {
      chosen.splice(k + 1, 0, best);
      k--; // re-check the new gaps
    }
  }
  return chosen.map((c) => c.p);
}

/** Route stretches with notable weather, for subtle coloring of the route line. */
export function weatherRouteSegments(points: RouteWeatherPoint[], totalDistM: number): WeatherRouteSegment[] {
  const pts = points.filter(hasWeather);
  const out: WeatherRouteSegment[] = [];
  pts.forEach((p, i) => {
    const d = p.distanceFromStartKm * 1000;
    const prevD = i > 0 ? pts[i - 1].distanceFromStartKm * 1000 : 0;
    const nextD = i < pts.length - 1 ? pts[i + 1].distanceFromStartKm * 1000 : totalDistM;
    const startM = i === 0 ? 0 : (prevD + d) / 2;
    const endM = i === pts.length - 1 ? totalDistM : (d + nextD) / 2;
    const cls = groupClassOf(p.weather.condition);
    const last = out[out.length - 1];
    if (last && last.groupClass === cls && Math.abs(last.endM - startM) < 1) last.endM = endM;
    else out.push({ startM, endM, groupClass: cls });
  });
  return out.filter((s) => isNotableClass(s.groupClass));
}

/** One-glance summary: headline + per-stretch highlights. */
export function summarizeRouteWeather(
  points: RouteWeatherPoint[],
  m: Messages = en,
  temperatureUnit: TemperatureUnit = 'c',
): RouteWeatherSummary {
  const pts = points.filter(hasWeather);
  const S = m.weather.summary;
  if (pts.length === 0) {
    return { headline: S.unavailable, tone: 'unknown', highlights: [] };
  }
  const groups = groupWeather(pts, m);
  const temps = pts.map((p) => p.weather.temperature);
  const minT = Math.round(Math.min(...temps));
  const maxT = Math.round(Math.max(...temps));
  const detail = S.range(formatTemp(minT, temperatureUnit), formatTemp(maxT, temperatureUnit));
  const totalM = Math.max(1, pts[pts.length - 1].distanceFromStartKm * 1000 - pts[0].distanceFromStartKm * 1000);
  const byId = new Map(pts.map((p) => [p.id, p]));

  const near = (g: WeatherGroup) => bestNamedPoint(g, byId)?.placeName;
  const find = (...classes: WeatherGroupClass[]) => groups.find((g) => classes.includes(g.groupClass));

  let headline: string;
  let tone: RouteWeatherSummary['tone'];
  let headlineCondition: WeatherCondition | undefined;
  const storm = find('thunderstorm');
  const wintry = find('snow', 'sleet');
  const wetGroups = groups.filter((g) => ['rain', 'heavy-rain', 'thunderstorm', 'snow', 'sleet'].includes(g.groupClass));
  const wetShare =
    wetGroups.reduce((sum, g) => sum + Math.max(g.endDistanceM - g.startDistanceM, totalM / pts.length), 0) / totalM;
  const fog = find('fog');

  if (storm) {
    headline = S.storms(near(storm));
    tone = 'severe';
    headlineCondition = storm.condition;
  } else if (wintry) {
    headline = wintry.groupClass === 'snow' ? S.snow(near(wintry)) : S.freezing(near(wintry));
    tone = 'wintry';
    headlineCondition = wintry.condition;
  } else if (wetGroups.length > 0) {
    tone = 'wet';
    const g = wetGroups[0];
    headlineCondition = g.condition;
    if (wetShare >= 0.5) headline = S.rainMuch;
    else headline = S.group(g.label, near(g));
  } else if (fog) {
    headline = S.fog(near(fog));
    tone = 'wet';
    headlineCondition = fog.condition;
  } else {
    tone = 'dry';
    headline = groups.every((g) => g.groupClass === 'clear') ? S.clearDry : S.mostlyDry;
  }

  // Highlights: origin stretch, destination stretch, plus the most notable others.
  const firstId = pts[0].id;
  const lastId = pts[pts.length - 1].id;
  const phrase = (g: WeatherGroup): string => {
    if (g.pointIds.includes(firstId) && pts[0].placeName) return S.groupIn(g.label, pts[0].placeName);
    const lastName = pts[pts.length - 1].placeName;
    if (g.pointIds.includes(lastId) && lastName) return S.groupIn(g.label, lastName);
    return S.group(g.label, bestNamedPoint(g, byId)?.placeName);
  };
  let chosen = groups;
  if (groups.length > 5) {
    const middle = groups
      .slice(1, -1)
      .sort((a, b) => SEVERITY[b.groupClass] - SEVERITY[a.groupClass])
      .slice(0, 3);
    chosen = groups.filter((g, i) => i === 0 || i === groups.length - 1 || middle.includes(g));
  }
  const highlights = chosen.map((g) => {
    const rep = byId.get(g.fromPointId);
    return { condition: g.condition, text: phrase(g), isDay: rep?.weather.isDay ?? true };
  });

  return { headline, detail, tone, minTemperature: minT, maxTemperature: maxT, highlights, headlineCondition: headlineCondition ?? highlights[0]?.condition };
}

/**
 * The most recognisable named place in a stretch: cities > towns > villages
 * > reverse-geocoded names; the earliest wins ties.
 */
function bestNamedPoint(g: WeatherGroup, byId: Map<string, WithWeather>): WithWeather | undefined {
  const rank = (p: WithWeather) =>
    (p.placeKind === 'city' ? 6 : p.placeKind === 'town' ? 4 : p.placeKind === 'village' ? 2 : 0) +
    (p.placeRelation === 'in' ? 1 : 0);
  let best: WithWeather | undefined;
  for (const id of g.pointIds) {
    const p = byId.get(id);
    if (!p?.placeName) continue;
    if (!best || rank(p) > rank(best)) best = p;
  }
  return best;
}
