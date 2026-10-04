# ADR-002 — Frontend: Vite + React SPA (no Next.js / Astro)

**Status:** Accepted · **Date:** 2026-10-02

## Context
The app is a map-first, highly interactive client (MapLibre, GPS loop,
navigation camera, voice, offline shell). It already runs as a Vite 6 + React
19 + zustand SPA with lazy chunks (MapLibre, Russian messages) and a service
worker. The brief asks to choose a framework on requirements, not popularity.

## Options
1. Keep Vite + React SPA.
2. Next.js (SSR/RSC) on Cloudflare (via an adapter).
3. Astro (islands) with React islands.
4. SvelteKit / SolidStart rewrite.

## Decision
Keep **Vite + React SPA**. Add server rendering only for a small number of
static content pages if SEO work proves them valuable (ROADMAP, UX_AND_GROWTH
§SEO) — and then as prerendered HTML, not a framework migration.

## Reason
- Almost every screen depends on client-only APIs (geolocation, WebGL map,
  speech, wake lock); SSR adds nothing to them.
- The engines are framework-free TypeScript; the UI layer is thin.
- A rewrite would put 548 tests' worth of behaviour at risk for no user benefit.
- Vite output is plain static assets — the cheapest thing Workers can serve.

## Consequences
- SEO is limited to the home page and any prerendered guides (acceptable: the
  product is a tool, not content).
- Bundle discipline is manual: main chunk is 583 KB (188 KB gz); split further
  (REQ-PERF-004).

## Alternatives rejected
- **Next.js:** SSR/RSC unused, adapter complexity on Workers, larger runtime.
- **Astro:** good for content sites; this is an app — islands would wrap almost everything.
- **Rewrite in another framework:** no requirement drives it.
