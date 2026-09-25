import { create } from 'zustand';

/** Screen space covered by floating UI, so the map can keep the route visible. */
export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const useLayoutStore = create<{ insets: Insets; setInsets(p: Partial<Insets>): void }>((set, get) => ({
  insets: { top: 80, bottom: 280, left: 0, right: 0 },
  setInsets: (p) => {
    const cur = get().insets;
    const next = { ...cur, ...p };
    if (next.top !== cur.top || next.bottom !== cur.bottom || next.left !== cur.left || next.right !== cur.right) {
      set({ insets: next });
    }
  },
}));
