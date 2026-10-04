#!/usr/bin/env node
/**
 * Before `wrangler dev`: the Worker serves dist/ as its static assets, so it must exist in development, and our
 * places tiles (public/data/places, built by `npm run data:osm`) must be in it — the Worker reads them for Long
 * Trip stops as it does when deployed. A production build (`npm run build`) copies them anyway.
 */
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function prepareWorkerAssets() {
  mkdirSync('dist', { recursive: true });
  const tiles = 'public/data/places/v1/index.json';
  const copy = 'dist/data/places/v1/index.json';
  if (existsSync(tiles) && (!existsSync(copy) || statSync(copy).mtimeMs < statSync(tiles).mtimeMs)) {
    cpSync('public/data/places', 'dist/data/places', { recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) prepareWorkerAssets();
