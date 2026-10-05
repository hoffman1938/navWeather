/**
 * Timezone helpers. Internally every timestamp is UTC epoch ms; these only
 * convert for display or for interpreting a wall-clock time picked by the
 * user. Never assume the device timezone equals the route's timezone.
 */

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions, locale?: string) {
  const key = `${locale ?? ''}|${timeZone}|${JSON.stringify(options)}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone });
    formatterCache.set(key, f);
  }
  return f;
}

let deviceTz: { tz: string; at: number } | null = null;

/** Device timezone (re-read every 10 min — the device may cross zones). */
export function deviceTimeZone(): string {
  const now = Date.now();
  if (deviceTz && now - deviceTz.at < 600_000) return deviceTz.tz;
  let tz = 'UTC';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    /* keep UTC */
  }
  deviceTz = { tz, at: now };
  return tz;
}

const validTz = new Map<string, boolean>();

/** Cached: constructing Intl.DateTimeFormat per call was the main derive() cost. */
export function isValidTimeZone(tz: string | undefined): tz is string {
  if (!tz) return false;
  let ok = validTz.get(tz);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      ok = true;
    } catch {
      ok = false;
    }
    validTz.set(tz, ok);
  }
  return ok;
}

/** "10:05" — 24h clock in the given timezone. */
export function formatLocalTime(utcMs: number, timeZone: string): string {
  const tz = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  return formatter(tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, 'en-GB').format(
    new Date(utcMs),
  );
}

/** "Sat 26 Sep" in the given timezone. */
export function formatLocalDate(utcMs: number, timeZone: string): string {
  const tz = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  return formatter(tz, { weekday: 'short', day: 'numeric', month: 'short' }, 'en-GB').format(
    new Date(utcMs),
  );
}

/** Calendar date key "2026-09-26" in the given timezone (for "tomorrow" labels). */
export function localDateKey(utcMs: number, timeZone: string): string {
  const parts = zonedParts(utcMs, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * Wall-clock parts of an instant in a zone. Hot (trip schedules ask tens of thousands of times), so the zone's
 * offset is computed once per zone and quarter hour and the parts come from arithmetic: offsets change only on
 * 15-minute UTC boundaries (every offset in use is a multiple of 15 minutes, and so are the moments it changes).
 */
export function zonedParts(utcMs: number, timeZone: string): ZonedParts {
  const tz = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const offsetMs = quarterOffsetMs(utcMs, tz);
  const d = new Date(utcMs + offsetMs);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

const QUARTER_MS = 15 * 60_000;
const offsetCache = new Map<string, number>();

function quarterOffsetMs(utcMs: number, tz: string): number {
  const start = Math.floor(utcMs / QUARTER_MS) * QUARTER_MS;
  const key = `${tz}|${start}`;
  let off = offsetCache.get(key);
  if (off === undefined) {
    const p = intlParts(start, tz);
    off = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - start;
    if (offsetCache.size >= 20_000) offsetCache.clear();
    offsetCache.set(key, off);
  }
  return off;
}

function intlParts(utcMs: number, tz: string): ZonedParts {
  const parts = formatter(
    tz,
    {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    },
    'en-US',
  ).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of `timeZone` from UTC at a given instant, in minutes (Tbilisi → +240). */
export function timeZoneOffsetMinutes(utcMs: number, timeZone: string): number {
  const p = zonedParts(utcMs, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(utcMs / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60000);
}

/** "GMT+4" style label. */
export function formatUtcOffset(utcMs: number, timeZone: string): string {
  const m = timeZoneOffsetMinutes(utcMs, timeZone);
  const sign = m >= 0 ? '+' : '−';
  const abs = Math.abs(m);
  const h = Math.floor(abs / 60);
  const mm = abs % 60;
  return `GMT${sign}${h}${mm ? `:${String(mm).padStart(2, '0')}` : ''}`;
}

/**
 * Interpret a wall-clock time in `timeZone` and return the UTC instant.
 * Handles DST: for skipped times the result moves forward; for repeated
 * times the earlier instant is returned.
 */
export function zonedWallTimeToUtc(
  wall: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
): number {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  // Offsets a day either side cover any single DST transition around this time.
  const before = timeZoneOffsetMinutes(naive - 86400000, timeZone);
  const after = timeZoneOffsetMinutes(naive + 86400000, timeZone);
  const candidates = [naive - before * 60000, naive - after * 60000].sort((a, b) => a - b);
  for (const c of candidates) {
    const p = zonedParts(c, timeZone);
    if (
      p.year === wall.year &&
      p.month === wall.month &&
      p.day === wall.day &&
      p.hour === wall.hour &&
      p.minute === wall.minute
    ) {
      return c; // earliest valid instant (repeated hour → first occurrence)
    }
  }
  // Wall time skipped by a DST jump: use the pre-transition offset (lands after the gap).
  return naive - before * 60000;
}

/** Parse the value of an <input type="datetime-local"> as a wall time in `timeZone`. */
export function parseDateTimeLocal(value: string, timeZone: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  return zonedWallTimeToUtc(
    { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5] },
    timeZone,
  );
}

/** Format a UTC instant as an <input type="datetime-local"> value in `timeZone`. */
export function toDateTimeLocalValue(utcMs: number, timeZone: string): string {
  const p = zonedParts(utcMs, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Short weekday in the UI language, e.g. "Mon" / "пн". */
export function formatWeekday(utcMs: number, timeZone: string, locale: string): string {
  const tz = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  return formatter(tz, { weekday: 'short' }, locale).format(new Date(utcMs));
}
