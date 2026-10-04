/**
 * The layers of our places tiles: which OpenStreetMap features go where, at which tile zoom, and which tags are
 * kept. Mirrors what the app used to ask Overpass for (src/services/places/*, src/services/speed/*,
 * src/trip/stops/places.ts), so the switch changes the source, not the results.
 */

const is = (re) => (v) => typeof v === 'string' && re.test(v);
const amenity = (re) => (t) => is(re)(t.amenity);

/** `types`: n = nodes, w = ways (as their bounding-box centre, like Overpass `out center`). */
export const LAYERS = [
  { id: 'settlement', z: 9, types: 'n', match: (t) => is(/^(city|town|village)$/)(t.place) && !!t.name },
  { id: 'fuel', z: 11, types: 'nw', match: amenity(/^fuel$/) },
  { id: 'ev_charging', z: 11, types: 'nw', match: amenity(/^charging_station$/) },
  { id: 'restaurant', z: 11, types: 'nw', match: amenity(/^(restaurant|fast_food)$/) },
  { id: 'cafe', z: 11, types: 'nw', match: amenity(/^cafe$/) },
  { id: 'hotel', z: 11, types: 'nw', match: (t) => is(/^(hotel|motel|guest_house|hostel)$/)(t.tourism) },
  { id: 'parking', z: 11, types: 'nw', match: amenity(/^parking$/) },
  { id: 'atm', z: 11, types: 'nw', match: (t) => t.amenity === 'atm' || (t.amenity === 'bank' && t.atm === 'yes') },
  { id: 'pharmacy', z: 11, types: 'nw', match: amenity(/^pharmacy$/) },
  { id: 'supermarket', z: 11, types: 'nw', match: (t) => is(/^(supermarket|convenience)$/)(t.shop) },
  { id: 'rest_area', z: 11, types: 'nw', match: (t) => is(/^(rest_area|services)$/)(t.highway) },
  { id: 'car_wash', z: 11, types: 'nw', match: amenity(/^car_wash$/) },
  { id: 'car_repair', z: 11, types: 'nw', match: (t) => is(/^(car_repair|tyres)$/)(t.shop) },
  { id: 'attraction', z: 11, types: 'nw', match: (t) => is(/^(attraction|viewpoint)$/)(t.tourism) },
  { id: 'toilets', z: 11, types: 'nw', match: amenity(/^toilets$/) },
  { id: 'hospital', z: 11, types: 'nw', match: amenity(/^hospital$/) },
  { id: 'speed_camera', z: 11, types: 'n', match: (t) => t.highway === 'speed_camera' },
  { id: 'level_crossing', z: 11, types: 'n', match: (t) => t.railway === 'level_crossing' },
  // Roads with a posted limit: ways with their geometry (handled in build.mjs).
  { id: 'maxspeed', z: 11, types: 'w', match: null },
];

export const POINT_LAYERS = LAYERS.filter((l) => l.match);

/** The road classes the speed-limit layer keeps (as the Overpass query did). */
export const ROAD_LIMIT_HIGHWAY = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential)(_link)?$/;

/** Point layers a feature belongs to (a fuel station with a shop can be in two). */
export function layersOf(tags, layers, type = 'n') {
  if (!tags || !Object.keys(tags).length) return [];
  return layers.filter((l) => l.types.includes(type) && l.match(tags));
}

/** Tags the app reads (names, brand, hours, stars, EV sockets, fuel, parking…); the rest is dropped. */
const KEEP = /^(name|name:(en|ru|ka)|int_name|brand|brand:(en|ru)|operator|operator:(en|ru)|opening_hours|amenity|tourism|shop|highway|railway|place|population|maxspeed|stars|hgv|capacity|toilets|parking|parking:fee|atm|fuel:.+|socket:.+|charging_station:output|cuisine)$/;

export function keepTags(tags) {
  const out = {};
  for (const [k, v] of Object.entries(tags)) if (KEEP.test(k)) out[k] = v;
  return out;
}

/** Slippy-map tile of a point. */
export function tileOf(lon, lat, z) {
  const n = 2 ** z;
  const x = Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
  const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  const y = Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)));
  return [x, y];
}

/** Every tile a bounding box [w, s, e, n] touches. */
export function tilesOfBbox([w, s, e, n], z) {
  const [x0, y0] = tileOf(w, n, z);
  const [x1, y1] = tileOf(e, s, z);
  const out = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y]);
  return out;
}
