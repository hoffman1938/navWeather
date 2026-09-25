/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // MapLibre's worker is an ES module that imports shared chunks.
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // MapLibre (~1 MB) is an intentional, lazily-loaded chunk.
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        // MapLibre is large; keep it in its own chunk so the app shell paints first.
        manualChunks: { maplibre: ['maplibre-gl'] },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
