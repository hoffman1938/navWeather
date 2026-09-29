import { create } from 'zustand';
import type { Locale } from '../../i18n';
import { NATURAL_VOICES, voiceById, type NaturalVoice } from './catalog';
import { naturalSupported, RUNTIME_URLS } from './NaturalSpeech';
import { downloadVoice, isVoiceStored, removeVoice } from './storage';

export type NaturalStatus = 'unknown' | 'none' | 'downloading' | 'ready' | 'error';

interface NaturalVoiceState {
  supported: boolean;
  /** Per voice id; a voice not checked yet is absent ('unknown'). */
  status: Record<string, NaturalStatus>;
  /** 0…1 while downloading. */
  progress: number;
  /** Find out which of a language's voices are already on the device. */
  check(locale: Locale): Promise<void>;
  download(voiceId: string): Promise<void>;
  cancel(): void;
  remove(voiceId: string): Promise<void>;
}

let downloadAbort: AbortController | null = null;

export const statusOf = (st: { status: Record<string, NaturalStatus> }, voiceId: string): NaturalStatus => st.status[voiceId] ?? 'unknown';

/** A language's first downloaded voice (the list is in order of preference). */
export function readyVoice(locale: Locale): NaturalVoice | null {
  const st = useNaturalVoice.getState();
  return NATURAL_VOICES[locale].find((v) => st.status[v.id] === 'ready') ?? null;
}

/** Download state of the on-device natural voices (the files live in Cache Storage). */
export const useNaturalVoice = create<NaturalVoiceState>()((set, get) => {
  const setStatus = (id: string, s: NaturalStatus) => set((st) => ({ status: { ...st.status, [id]: s } }));
  return {
    supported: naturalSupported(),
    status: {},
    progress: 0,

    async check(locale) {
      if (!get().supported) return;
      await Promise.all(
        NATURAL_VOICES[locale].map(async (v) => {
          if (get().status[v.id] === 'downloading') return;
          const stored = await isVoiceStored(v);
          if (get().status[v.id] !== 'downloading') setStatus(v.id, stored ? 'ready' : 'none');
        }),
      );
    },

    async download(voiceId) {
      const v = voiceById(voiceId);
      const now = get().status[voiceId];
      if (!v || !get().supported || now === 'downloading' || now === 'ready') return;
      downloadAbort?.abort();
      const ctrl = new AbortController();
      downloadAbort = ctrl;
      // One download at a time: a voice whose download was just replaced is back to "not downloaded".
      set((st) => ({
        status: Object.fromEntries(Object.entries(st.status).map(([id, s]) => [id, s === 'downloading' ? 'none' : s])),
        progress: 0,
      }));
      setStatus(voiceId, 'downloading');
      try {
        await downloadVoice(v, RUNTIME_URLS, (progress) => set({ progress }), ctrl.signal);
        set((st) => ({ status: { ...st.status, [voiceId]: 'ready' }, progress: 1 }));
      } catch {
        if (downloadAbort === ctrl || !ctrl.signal.aborted) setStatus(voiceId, ctrl.signal.aborted ? 'none' : 'error');
      } finally {
        if (downloadAbort === ctrl) downloadAbort = null;
      }
    },

    cancel() {
      downloadAbort?.abort();
    },

    async remove(voiceId) {
      const v = voiceById(voiceId);
      if (v) await removeVoice(v).catch(() => undefined);
      setStatus(voiceId, 'none');
    },
  };
});
