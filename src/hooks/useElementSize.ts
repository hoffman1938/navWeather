import { useEffect, type RefObject } from 'react';

/** Report an element's size via ResizeObserver (used for map padding). */
export function useElementSize(ref: RefObject<HTMLElement | null>, onSize: (r: DOMRect) => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => onSize(el.getBoundingClientRect()));
    ro.observe(el);
    onSize(el.getBoundingClientRect());
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
}
