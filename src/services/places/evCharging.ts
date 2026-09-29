/**
 * EV charging details from OpenStreetMap tags (`socket:<type>`,
 * `socket:<type>:output`, `capacity`). Only what is mapped is shown — no
 * availability, prices or live status (no free source for those).
 */

export interface ChargingSocket {
  /** OSM socket key, e.g. `type2_combo`. */
  type: string;
  /** Number of such sockets, when mapped as a number. */
  count?: number;
  /** Maximum output, kW, when mapped. */
  kw?: number;
}

export interface ChargingInfo {
  sockets: ChargingSocket[];
  /** Fastest mapped output, kW. */
  maxKw?: number;
  /** Vehicles that can charge at once (`capacity`). */
  capacity?: number;
}

/** Standard connector names (the same in every language). */
const SOCKET_NAMES: Record<string, string> = {
  type2_combo: 'CCS2',
  type1_combo: 'CCS1',
  chademo: 'CHAdeMO',
  type2: 'Type 2',
  type2_cable: 'Type 2',
  type1: 'Type 1',
  tesla_supercharger: 'Tesla',
  tesla_destination: 'Tesla',
  nacs: 'NACS',
  gb_dc: 'GB/T DC',
  gb_ac: 'GB/T AC',
  schuko: 'Schuko',
};

/** DC (fast) connectors first. */
const ORDER = ['type2_combo', 'type1_combo', 'chademo', 'nacs', 'tesla_supercharger', 'gb_dc', 'type2', 'type2_cable', 'type1', 'tesla_destination', 'gb_ac', 'schuko'];

export function socketName(type: string): string {
  return SOCKET_NAMES[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** "50 kW", "22kW", "7,4 kW", "50000 W", "150 kW;50 kW" → max in kW. */
export function parseOutputKw(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  let best: number | undefined;
  for (const part of raw.split(/;|,(?!\d)/)) {
    const m = /^\s*(\d+(?:[.,]\d+)?)\s*(kw|w|kva)?\s*$/i.exec(part);
    if (!m) continue;
    const v = parseFloat(m[1].replace(',', '.'));
    const unit = m[2]?.toLowerCase();
    const kw = unit === 'w' ? v / 1000 : unit ? v : v <= 400 ? v : undefined;
    if (kw !== undefined && kw > 0 && kw <= 1000) best = Math.max(best ?? 0, kw);
  }
  return best;
}

export function parseCharging(tags: Record<string, string>): ChargingInfo | undefined {
  const sockets: ChargingSocket[] = [];
  for (const [key, value] of Object.entries(tags)) {
    const m = /^socket:([a-z0-9_]+)$/.exec(key);
    if (!m || value === 'no' || value === '0') continue;
    const n = parseInt(value, 10);
    sockets.push({
      type: m[1],
      ...(Number.isFinite(n) && n > 0 ? { count: n } : {}),
      ...(parseOutputKw(tags[`socket:${m[1]}:output`]) !== undefined ? { kw: parseOutputKw(tags[`socket:${m[1]}:output`]) } : {}),
    });
  }
  const rank = (t: string) => (ORDER.indexOf(t) < 0 ? ORDER.length : ORDER.indexOf(t));
  sockets.sort((a, b) => rank(a.type) - rank(b.type));
  const outputs = sockets.map((s) => s.kw).filter((k): k is number => k !== undefined);
  const stationKw = parseOutputKw(tags['charging_station:output']);
  const maxKw = outputs.length ? Math.max(...outputs) : stationKw;
  const cap = parseInt(tags.capacity ?? '', 10);
  if (!sockets.length && maxKw === undefined) return undefined;
  return { sockets, ...(maxKw !== undefined ? { maxKw } : {}), ...(Number.isFinite(cap) && cap > 0 ? { capacity: cap } : {}) };
}

/** "CCS2 ×2 · Type 2 · up to 150 kW" (connector names are standard, the rest localized by `upTo`). */
export function chargingSummary(info: ChargingInfo, upTo: (kw: string) => string): string {
  const names: string[] = [];
  for (const s of info.sockets) {
    const name = socketName(s.type);
    const label = s.count && s.count > 1 ? `${name} ×${s.count}` : name;
    if (!names.some((n) => n === label || n.startsWith(`${name} ×`) || n === name)) names.push(label);
  }
  const kw = info.maxKw !== undefined ? upTo(`${Math.round(info.maxKw * 10) / 10} kW`) : null;
  return [...names, kw].filter(Boolean).join(' · ');
}
