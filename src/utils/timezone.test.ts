import { describe, expect, it } from 'vitest';
import {
  formatLocalTime,
  formatUtcOffset,
  parseDateTimeLocal,
  timeZoneOffsetMinutes,
  toDateTimeLocalValue,
  zonedParts,
  zonedWallTimeToUtc,
} from './timezone';
import { en } from '../i18n/en';
import { ru } from '../i18n/ru';
import { defaultUnits, formatDistance, formatDuration, formatAgo, spokenDistance, spokenDuration } from '../i18n/format';

const T = Date.UTC(2026, 8, 26, 4, 5); // 2026-09-26 04:05Z

describe('timezone conversion', () => {
  it('formats the same instant differently per route location', () => {
    expect(formatLocalTime(T, 'Asia/Tbilisi')).toBe('08:05'); // UTC+4
    expect(formatLocalTime(T, 'Europe/Istanbul')).toBe('07:05'); // UTC+3
    expect(formatLocalTime(T, 'UTC')).toBe('04:05');
  });

  it('computes offsets and labels', () => {
    expect(timeZoneOffsetMinutes(T, 'Asia/Tbilisi')).toBe(240);
    expect(formatUtcOffset(T, 'Asia/Tbilisi')).toBe('GMT+4');
    expect(formatUtcOffset(T, 'Asia/Kolkata')).toBe('GMT+5:30');
    expect(formatUtcOffset(T, 'America/New_York')).toBe('GMT−4');
  });

  it('converts a wall time in the route timezone to UTC (not the device timezone)', () => {
    const utc = zonedWallTimeToUtc({ year: 2026, month: 9, day: 26, hour: 8, minute: 5 }, 'Asia/Tbilisi');
    expect(utc).toBe(T);
    expect(parseDateTimeLocal('2026-09-26T08:05', 'Asia/Tbilisi')).toBe(T);
    expect(toDateTimeLocalValue(T, 'Asia/Tbilisi')).toBe('2026-09-26T08:05');
  });

  it('handles DST transitions', () => {
    // Europe/Berlin springs forward 2026-03-29 02:00 → 03:00.
    const skipped = zonedWallTimeToUtc({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, 'Europe/Berlin');
    expect(formatLocalTime(skipped, 'Europe/Berlin')).toBe('03:30');
    // Falls back 2026-10-25 03:00 → 02:00; 02:30 occurs twice → earlier (CEST) instant.
    const repeated = zonedWallTimeToUtc({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }, 'Europe/Berlin');
    expect(repeated).toBe(Date.UTC(2026, 9, 25, 0, 30));
    // Summer / winter offsets
    expect(timeZoneOffsetMinutes(Date.UTC(2026, 6, 1), 'Europe/Berlin')).toBe(120);
    expect(timeZoneOffsetMinutes(Date.UTC(2026, 0, 1), 'Europe/Berlin')).toBe(60);
  });
});

describe('localized formatting', () => {
  it('formats travel durations', () => {
    expect(formatDuration(0, en)).toBe('<1 min');
    expect(formatDuration(55 * 60, en)).toBe('55 min');
    expect(formatDuration(5 * 3600 + 5 * 60, en)).toBe('5 h 5 min');
    expect(formatDuration(2 * 3600, en)).toBe('2 h');
    expect(formatDuration(3 * 3600 + 12 * 60, ru)).toBe('3 ч 12 мин');
    expect(formatAgo(0, 18 * 60000, en)).toBe('18 min ago');
    expect(formatAgo(0, 20_000, en)).toBe('just now');
  });

  it('speaks durations and distances naturally (with plurals)', () => {
    expect(spokenDuration(25 * 60, en)).toBe('about 25 minutes');
    expect(spokenDuration(60 * 60, en)).toBe('about an hour');
    expect(spokenDuration(80 * 60, en)).toBe('about 1 hour 20 minutes');
    expect(spokenDuration(2 * 60, en)).toBe('a few minutes');
    expect(spokenDuration(21 * 60, ru)).toBe('примерно через 20 минут');
    expect(spokenDuration(3 * 3600 + 5 * 60, ru)).toBe('примерно через 3 часа 5 минут');
    expect(spokenDistance(480, 'metric', en)).toBe('500 meters');
    expect(spokenDistance(2400, 'metric', en)).toBe('2.5 kilometers');
    expect(spokenDistance(1200, 'metric', ru)).toBe('1 километр');
    expect(spokenDistance(22_000, 'metric', ru)).toBe('22 километра');
    expect(spokenDistance(800, 'imperial', en)).toBe('half a mile');
  });

  it('formats distances in the user\'s units', () => {
    expect(formatDistance(357_700, 'metric', en)).toBe('358 km');
    expect(formatDistance(1_250, 'metric', en)).toBe('1.3 km');
    expect(formatDistance(357_700, 'imperial', en)).toBe('222 mi');
    expect(formatDistance(1_250, 'metric', ru)).toBe('1,3 км');
  });
});

describe('unit defaults', () => {
  it('uses imperial only for US locale + US timezone', () => {
    expect(defaultUnits('en-US', 'America/New_York')).toEqual({ distance: 'imperial', temperature: 'f', wind: 'mph' });
    expect(defaultUnits('en-US', 'Asia/Tbilisi')).toEqual({ distance: 'metric', temperature: 'c', wind: 'kmh' });
    expect(defaultUnits('en-GB', 'Europe/London')).toEqual({ distance: 'imperial', temperature: 'c', wind: 'mph' });
    expect(defaultUnits('ka-GE', 'Asia/Tbilisi').distance).toBe('metric');
  });
});

describe('zonedParts (offset cached per quarter hour)', () => {
  const intl = (ms: number, tz: string) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
    const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
    return { year: g('year'), month: g('month'), day: g('day'), hour: g('hour') % 24, minute: g('minute'), second: g('second') };
  };

  it('agrees with Intl everywhere, also across odd offsets and DST changes', () => {
    // Kathmandu +5:45, Chatham +12:45/+13:45, Lord Howe's 30-minute DST, Tehran +3:30, Berlin and New York DST.
    const zones = ['Asia/Kathmandu', 'Pacific/Chatham', 'Australia/Lord_Howe', 'Asia/Tehran', 'Europe/Berlin', 'America/New_York', 'Asia/Tbilisi', 'UTC'];
    const starts = [Date.UTC(2026, 2, 28, 22), Date.UTC(2026, 3, 4, 13), Date.UTC(2026, 9, 3, 14), Date.UTC(2026, 9, 24, 22), Date.UTC(2026, 10, 1, 4)];
    for (const tz of zones) {
      for (const t0 of starts) {
        for (let ms = t0; ms < t0 + 6 * 3600_000; ms += 7 * 60_000 + 13_000) expect(zonedParts(ms, tz), `${tz} ${new Date(ms).toISOString()}`).toEqual(intl(ms, tz));
      }
    }
  });

  it('an unknown zone reads as UTC', () => {
    expect(zonedParts(Date.UTC(2026, 0, 1, 12, 30, 5), 'Mars/Olympus')).toEqual({ year: 2026, month: 1, day: 1, hour: 12, minute: 30, second: 5 });
  });
});
