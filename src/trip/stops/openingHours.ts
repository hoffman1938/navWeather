/**
 * OpenStreetMap `opening_hours` — a deliberately small, safe subset:
 *   "24/7" · "Mo-Fr 08:00-20:00; Sa 09:00-14:00" · "Mo,We 10:00-12:00,14:00-18:00"
 *   · "18:00-02:00" (past midnight) · "Su off" · "PH off" (ignored).
 * Later rules override earlier ones for the days they name (OSM semantics).
 * Anything else (months, weeks, sunrise, comments, "open"/"unknown") →
 * 'unknown'. Never guess a place is open.
 */

export type OpenStatus = 'open' | 'closed' | 'unknown';

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** `weekday`: 0 = Monday … 6 = Sunday (local); `minutes`: local minutes after midnight. */
export function openStatus(spec: string | undefined, weekday: number, minutes: number): OpenStatus {
  if (!spec) return 'unknown';
  const text = spec.trim();
  if (text === '24/7') return 'open';
  const rules = text.split(/\s*;\s*/).filter(Boolean);
  // For each day: list of [from, to) minute spans, set by the last rule naming that day; undefined = not mentioned.
  const byDay: (number[][] | undefined)[] = new Array(7).fill(undefined);
  for (const rule of rules) {
    const parsed = parseRule(rule);
    if (!parsed) {
      // Public-holiday rules can't be evaluated without a holiday calendar — skip them, they don't make the rest unknown.
      if (/^PH\b/.test(rule)) continue;
      return 'unknown';
    }
    for (const d of parsed.days) byDay[d] = parsed.spans;
  }
  // A span past midnight belongs to the previous day's entry.
  const today = byDay[weekday];
  const yesterday = byDay[(weekday + 6) % 7];
  if (today === undefined && yesterday === undefined) return byDay.every((d) => d === undefined) ? 'unknown' : 'closed';
  for (const [from, to] of today ?? []) {
    if (to > from ? minutes >= from && minutes < to : minutes >= from) return 'open';
  }
  for (const [from, to] of yesterday ?? []) {
    if (to <= from && minutes < to) return 'open';
  }
  return 'closed';
}

function parseRule(rule: string): { days: number[]; spans: number[][] } | null {
  const m = /^(?:([A-Za-z,\- ]+?)\s+)?((?:\d{1,2}:\d{2}-\d{1,2}:\d{2}(?:\s*,\s*)?)+|off|closed)$/.exec(rule.trim());
  if (!m) return null;
  const days = m[1] ? parseDays(m[1]) : [0, 1, 2, 3, 4, 5, 6];
  if (!days) return null;
  if (m[2] === 'off' || m[2] === 'closed') return { days, spans: [] };
  const spans: number[][] = [];
  for (const part of m[2].split(/\s*,\s*/).filter(Boolean)) {
    const t = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(part);
    if (!t) return null;
    const from = Number(t[1]) * 60 + Number(t[2]);
    let to = Number(t[3]) * 60 + Number(t[4]);
    if (from > 24 * 60 || to > 48 * 60) return null;
    if (to > 24 * 60) to -= 24 * 60; // "20:00-26:00" = until 02:00
    spans.push([from, to === from ? from + 24 * 60 : to]);
  }
  return { days, spans };
}

function parseDays(text: string): number[] | null {
  const out = new Set<number>();
  for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const r = /^([A-Z][a-z])(?:-([A-Z][a-z]))?$/.exec(part);
    if (!r) return null;
    const a = DAYS.indexOf(r[1]);
    const b = r[2] ? DAYS.indexOf(r[2]) : a;
    if (a < 0 || b < 0) return null;
    for (let i = a; ; i = (i + 1) % 7) {
      out.add(i);
      if (i === b) break;
    }
  }
  return [...out];
}
