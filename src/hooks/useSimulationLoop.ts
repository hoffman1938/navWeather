import { useEffect } from 'react';
import { useAppStore } from '../state/store';

/** Drives the demo vehicle with requestAnimationFrame while playing. */
export function useSimulationLoop() {
  const playing = useAppStore((s) => s.mode === 'simulating' && s.sim.playing);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const frame = (t: number) => {
      // Clamp so a backgrounded tab doesn't teleport the car.
      const dt = Math.min(250, t - last);
      last = t;
      useAppStore.getState().advanceSimulationBy(dt);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}
