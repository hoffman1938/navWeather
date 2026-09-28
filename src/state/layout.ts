import { create } from 'zustand';

/** Screen space covered by floating UI, so the map can keep the route visible. */
export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

interface LayoutState {
  insets: Insets;
  /** A bottom sheet covers most of the map: floating map buttons step aside. */
  sheetCovers: boolean;
  setInsets(p: Partial<Insets>): void;
  setSheetCovers(v: boolean): void;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  insets: { top: 80, bottom: 280, left: 0, right: 0 },
  sheetCovers: false,
  setSheetCovers: (sheetCovers) => {
    if (get().sheetCovers !== sheetCovers) set({ sheetCovers });
  },
  setInsets: (p) => {
    const cur = get().insets;
    const next = { ...cur, ...p };
    if (next.top !== cur.top || next.bottom !== cur.bottom || next.left !== cur.left || next.right !== cur.right) {
      set({ insets: next });
    }
  },
}));
