import { Component, type ReactNode } from 'react';

/**
 * Keeps the app usable if a lazily loaded part (the map) fails — e.g. an old
 * tab requesting a chunk that a new deploy replaced. One automatic reload
 * fixes that case; otherwise the fallback is shown and navigation continues.
 */
export class ErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    const msg = String((error as Error)?.message ?? error);
    if (/dynamically imported module|Importing a module script failed|Failed to fetch/i.test(msg)) {
      try {
        if (!sessionStorage.getItem('navweather.reloaded')) {
          sessionStorage.setItem('navweather.reloaded', '1');
          location.reload();
        }
      } catch {
        /* storage blocked: show fallback */
      }
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
