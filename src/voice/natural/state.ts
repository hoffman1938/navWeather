import { create } from 'zustand';
import type { Locale } from '../../i18n';
import { NATURAL_VOICES } from './catalog';
import { naturalSupported, RUNTIME_URLS } from './NaturalSpeech';
import { downloadVoice, isVoiceStored, removeVoice } from './storage';

export type NaturalStatus = 'unknown' | 'none' | 'downloading' | 'ready' | 'error';

interface NaturalVoiceState {
  supported: boolean;
  status: Record<Locale, NaturalStatus>;
  /** 0…1 while downloading. */
  progress: number;
  check(locale: Locale): Promise<void>;
  download(locale: Locale): Promise<void>;
  cancel(): void;
  remove(locale: Locale): Promise<void>;
}

let downloadAbort: AbortController | null = null;

/** Download state of the on-device natural voice, per language (the files live in Cache Storage). */
export const useNaturalVoice = create<NaturalVoiceState>()((set, get) => ({
  supported: naturalSupported(),
  status: { en: 'unknown', ru: 'unknown', ka: 'unknown' },
  progress: 0,

  async check(locale) {
    if (!get().supported || get().status[locale] === 'downloading') return;
    const stored = await isVoiceStored(NATURAL_VOICES[locale]);
    if (get().status[locale] !== 'downloading') set((s) => ({ status: { ...s.status, [locale]: stored ? 'ready' : 'none' } }));
  },

  async download(locale) {
    if (!get().supported || get().status[locale] === 'downloading' || get().status[locale] === 'ready') return;
    downloadAbort?.abort();
    const ctrl = new AbortController();
    downloadAbort = ctrl;
    set((s) => ({ status: { ...s.status, [locale]: 'downloading' }, progress: 0 }));
    try {
      await downloadVoice(NATURAL_VOICES[locale], RUNTIME_URLS, (progress) => set({ progress }), ctrl.signal);
      set((s) => ({ status: { ...s.status, [locale]: 'ready' }, progress: 1 }));
    } catch {
      set((s) => ({ status: { ...s.status, [locale]: ctrl.signal.aborted ? 'none' : 'error' } }));
    } finally {
      if (downloadAbort === ctrl) downloadAbort = null;
    }
  },

  cancel() {
    downloadAbort?.abort();
  },

  async remove(locale) {
    await removeVoice(NATURAL_VOICES[locale]).catch(() => undefined);
    set((s) => ({ status: { ...s.status, [locale]: 'none' } }));
  },
}));
