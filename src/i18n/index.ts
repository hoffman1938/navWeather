import { en, type Messages } from './en';

export type Locale = 'en' | 'ru';
export const LOCALES: { id: Locale; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'ru', name: 'Русский' },
];

/**
 * English ships with the app; Russian loads on demand, so nobody downloads a
 * language they don't use.
 */
const table: Partial<Record<Locale, Messages>> = { en };
const loaders: Record<Exclude<Locale, 'en'>, () => Promise<Messages>> = {
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
  return base === 'ru' ? base : 'en';
}

export { en };
export type { Messages };
