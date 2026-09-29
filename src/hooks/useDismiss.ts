import { useEffect, type RefObject } from 'react';

/** Close a popover on a tap/click outside `ref` or on Escape (menus, pickers). */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
    // `close` is usually a new function each render; only `open` decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ref]);
}
