import { defineConfig } from '@playwright/test';

/**
 * Browser smoke test (DEVELOPMENT_PLAN DP-2.6): the same suite on localhost and on the preview Worker.
 *   npm run dev            then   npm run e2e                          (http://localhost:5173)
 *   BASE_URL=https://navweather-preview.<you>.workers.dev npm run e2e  (preview — never production: it shares and reports)
 * It drives the installed Google Chrome (`channel: 'chrome'`) — no browser download.
 */
export default defineConfig({
  testDir: 'e2e',
  // Headless Chrome on a CI runner is slow (route planning and the weather derivation run in the page); generous.
  timeout: 300_000,
  expect: { timeout: 90_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173',
    channel: 'chrome',
    headless: true,
    locale: 'en-GB',
    timezoneId: 'Asia/Tbilisi',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
});
