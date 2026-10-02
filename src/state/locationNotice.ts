import { currentMessages } from './settings';

/**
 * Is this notice one of the location problems ("blocked", "waiting for GPS"…)?
 * Those are sticky, so they must go as soon as location works again — and not
 * take any other notice (a forecast update, a route change) with them.
 */
export function isLocationNotice(text: string | null | undefined): boolean {
  if (!text) return false;
  const l = currentMessages().location;
  return [...Object.values(l.errors), l.deniedIos, l.waitingGps, l.noAnswer].some((t) => text.startsWith(t));
}
