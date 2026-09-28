import { en, type Messages } from './en';

export type Locale = 'en' | 'ka' | 'ru';
export const LOCALES: { id: Locale; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'ka', name: 'ქართული' },
  { id: 'ru', name: 'Русский' },
];

/**
 * English ships with the app; other languages load on demand (Georgian and
 * Russian text is large), so nobody downloads languages they don't use.
 */
const table: Partial<Record<Locale, Messages>> = { en };
const loaders: Record<Exclude<Locale, 'en'>, () => Promise<Messages>> = {
  ka: () => import('./ka').then((mod) => mod.ka),
  ru: () => import('./ru').then((mod) => mod.ru),
};

export function getMessages(locale: Locale): Messages {
  return table[locale] ?? en;
}

export function isLocaleLoaded(locale: Locale): boolean {
  return !!table[locale];
}

export async function loadLocale(locale: Locale): Promise<void> {
  if (table[locale] || locale === 'en') return;
  table[locale] = await loaders[locale]();
}

/** Best supported locale for the browser language. */
export function detectLocale(lang = typeof navigator !== 'undefined' ? navigator.language : 'en'): Locale {
  const base = lang.slice(0, 2).toLowerCase();
  return base === 'ka' || base === 'ru' ? base : 'en';
}

export { en };
export type { Messages };
