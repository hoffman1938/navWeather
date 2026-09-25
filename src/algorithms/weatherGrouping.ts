import type {
  RouteWeatherPoint,
  RouteWeatherSummary,
  WeatherAtTime,
  WeatherCondition,
  WeatherEvent,
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
export function groupLabel(groupClass: WeatherGroupClass, points: WeatherAtTime[]): string {
  const maxProb = Math.max(0, ...points.map((w) => w.precipitationProbability ?? 0));
  switch (groupClass) {
    case 'clear':
      return points.every((w) => w.condition === 'CLEAR') ? 'Clear' : 'Mostly clear';
    case 'cloudy':
      return 'Cloudy';
    case 'fog':
      return 'Fog possible';
    case 'rain':
      return maxProb >= 60 ? 'Rain likely' : maxProb >= 30 ? 'Rain possible' : 'Light rain possible';
    case 'heavy-rain':
      return 'Heavy rain possible';
    case 'snow':
      return maxProb >= 60 ? 'Snow likely' : 'Snow possible';
    case 'sleet':
      return 'Freezing rain possible';
    case 'thunderstorm':
      return 'Thunderstorms possible';
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
export function groupWeather(points: RouteWeatherPoint[]): WeatherGroup[] {
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
      label: groupLabel(cls, ws),
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

function placePhrase(p: RouteWeatherPoint, first: boolean, last: boolean): string {
  if (!p.placeName) return `around km ${Math.round(p.distanceFromStartKm)}`;
  if ((first || last) && p.placeRelation === 'in') return `in ${p.placeName}`;
  return `near ${p.placeName}`;
}

/** Significant transitions along the route (rain begins, gusts, fog…). */
export function detectWeatherEvents(points: RouteWeatherPoint[]): WeatherEvent[] {
  const pts = points.filter(hasWeather);
  const events: WeatherEvent[] = [];
  const add = (type: WeatherEvent['type'], p: WithWeather, message: string, severity: WeatherEvent['severity']) =>
    events.push({
      id: `${type}:${p.id}`,
      type,
      pointId: p.id,
      message,
      severity,
      arrivalMs: p.arrivalMs,
      distanceM: p.distanceFromStartKm * 1000,
    });

  // Treat a short dry blip between wet stretches (wet neighbours <40 km apart,
  // i.e. about one sample) as wet, so rain "starts" once instead of flickering.
  const wetRaw = pts.map((p) => isPrecipitating(p.weather.condition));
  const wetSmoothed = [...wetRaw];
  for (let i = 0; i < pts.length; i++) {
    if (wetRaw[i] || !wetRaw[i - 1]) continue;
    let j = i;
    while (j < pts.length && !wetRaw[j]) j++;
    if (j < pts.length && pts[j].distanceFromStartKm - pts[i - 1].distanceFromStartKm < 40) {
      for (let k = i; k < j; k++) wetSmoothed[k] = true;
    }
    i = j;
  }

  let windActive = false;
  let visActive = false;
  let lastTempDropAtM = -Infinity;
  const startTemp = pts[0]?.weather.temperature;

  pts.forEach((p, i) => {
    const w = p.weather;
    const prev = pts[i - 1]?.weather;
    const where = placePhrase(p, i === 0, i === pts.length - 1);
    const wet = wetSmoothed[i];
    const prevWet = i > 0 ? wetSmoothed[i - 1] : false;
    const prob = w.precipitationProbability ?? 0;

    if (w.condition === 'THUNDERSTORM' && prev?.condition !== 'THUNDERSTORM') {
      add('thunderstorm', p, `Thunderstorms possible ${where}`, 'warning');
    } else if (w.condition === 'SNOW' && prev?.condition !== 'SNOW') {
      add('snow-start', p, `${prob >= 60 ? 'Snow likely' : 'Snow possible'} ${where}`, 'warning');
    } else if (w.condition === 'SLEET' && prev?.condition !== 'SLEET') {
      add('icy', p, `Freezing rain possible ${where} — roads may be icy`, 'warning');
    } else if ((w.condition === 'HEAVY_RAIN' || (w.precipitation ?? 0) >= 4) && prev?.condition !== 'HEAVY_RAIN') {
      add('heavy-precipitation', p, `Heavy rain possible ${where}`, 'warning');
    } else if (wet && !prevWet && isPrecipitating(w.condition)) {
      add('rain-start', p, `${prob >= 60 ? 'Rain likely' : 'Rain possible'} ${i === 0 ? where : `from ${where.replace(/^(near|in) /, '')}`}`, 'caution');
    } else if (!wet && prevWet) {
      add('rain-end', p, `Drier ${where}`, 'info');
    }

    if (wet && w.temperature <= 1 && w.condition !== 'SLEET') {
      add('icy', p, `Near-freezing with precipitation ${where} — roads may be icy`, 'warning');
    }

    const gusty = (w.windGusts ?? 0) >= 60 || (w.windSpeed ?? 0) >= 40;
    if (gusty && !windActive) {
      add('strong-wind', p, `Strong gusts (${w.windGusts ?? w.windSpeed} km/h) ${where}`, 'caution');
    }
    windActive = gusty;

    const lowVis = (w.visibility !== undefined && w.visibility < 1000) || w.condition === 'FOG';
    if (lowVis && !visActive) add('low-visibility', p, `Low visibility possible ${where}`, 'caution');
    visActive = lowVis;

    const distM = p.distanceFromStartKm * 1000;
    const dropFromPrev = prev ? prev.temperature - w.temperature : 0;
    const dropFromStart = startTemp !== undefined ? startTemp - w.temperature : 0;
    if ((dropFromPrev >= 5 || dropFromStart >= 8) && distM - lastTempDropAtM > 50_000) {
      add('temperature-drop', p, `Colder ${where}: ${Math.round(w.temperature)}°`, 'info');
      lastTempDropAtM = distM;
    }
  });
  return events;
}

/**
 * Pick the handful of points worth a card/marker: the ends, weather
 * transitions and events, named settlements — spread out in time. Avoids 30
 * identical cards when the weather does not change for 200 km.
 */
export function selectDisplayPoints(
  points: RouteWeatherPoint[],
  options: { includeFirst?: boolean; maxCards?: number } = {},
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
  const eventPoints = new Set(detectWeatherEvents(pts).filter((e) => e.severity !== 'info').map((e) => e.pointId));

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
export function summarizeRouteWeather(points: RouteWeatherPoint[]): RouteWeatherSummary {
  const pts = points.filter(hasWeather);
  if (pts.length === 0) {
    return { headline: 'Weather data temporarily unavailable', tone: 'unknown', highlights: [] };
  }
  const groups = groupWeather(pts);
  const temps = pts.map((p) => p.weather.temperature);
  const minT = Math.round(Math.min(...temps));
  const maxT = Math.round(Math.max(...temps));
  const detail = minT === maxT ? `Around ${minT}° along the way` : `${minT}–${maxT}° along the way`;
  const totalM = Math.max(1, pts[pts.length - 1].distanceFromStartKm * 1000 - pts[0].distanceFromStartKm * 1000);
  const byId = new Map(pts.map((p) => [p.id, p]));

  const where = (g: WeatherGroup) => {
    const p = bestNamedPoint(g, byId);
    return p?.placeName ? ` near ${p.placeName}` : '';
  };
  const find = (...classes: WeatherGroupClass[]) => groups.find((g) => classes.includes(g.groupClass));

  let headline: string;
  let tone: RouteWeatherSummary['tone'];
  const storm = find('thunderstorm');
  const wintry = find('snow', 'sleet');
  const wetGroups = groups.filter((g) => ['rain', 'heavy-rain', 'thunderstorm', 'snow', 'sleet'].includes(g.groupClass));
  const wetShare =
    wetGroups.reduce((sum, g) => sum + Math.max(g.endDistanceM - g.startDistanceM, totalM / pts.length), 0) / totalM;
  const fog = find('fog');

  if (storm) {
    headline = `Thunderstorms possible${where(storm)}`;
    tone = 'severe';
  } else if (wintry) {
    headline = `${wintry.groupClass === 'snow' ? 'Snow' : 'Freezing rain'} possible${where(wintry)}`;
    tone = 'wintry';
  } else if (wetGroups.length > 0) {
    tone = 'wet';
    if (wetShare >= 0.5) headline = 'Rain expected along much of your route';
    else {
      const g = wetGroups[0];
      headline = `${g.label}${where(g)}`;
    }
  } else if (fog) {
    headline = `Fog possible${where(fog)}`;
    tone = 'wet';
  } else {
    tone = 'dry';
    headline = groups.every((g) => g.groupClass === 'clear')
      ? 'Clear and dry along your route'
      : 'Mostly dry conditions along your route';
  }

  // Highlights: origin stretch, destination stretch, plus the most notable others.
  const firstId = pts[0].id;
  const lastId = pts[pts.length - 1].id;
  const phrase = (g: WeatherGroup): string => {
    if (g.pointIds.includes(firstId) && pts[0].placeName) return `${g.label} in ${pts[0].placeName}`;
    if (g.pointIds.includes(lastId) && pts[pts.length - 1].placeName)
      return `${g.label} in ${pts[pts.length - 1].placeName}`;
    const named = bestNamedPoint(g, byId);
    return named ? `${g.label} near ${named.placeName}` : g.label;
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

  return { headline, detail, tone, minTemperature: minT, maxTemperature: maxT, highlights };
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
