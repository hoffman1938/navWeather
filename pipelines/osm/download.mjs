#!/usr/bin/env node
/**
 * Download a regional OpenStreetMap extract from Geofabrik and check it (DEVELOPMENT_PLAN DP-4.1): the file and
 * its published MD5, kept under data/raw/ (git-ignored) with the data date. Open data on a fixed schedule —
 * class B of the "always free" rule (FREE_STACK_PLAN §1.1): the download does not grow with users.
 *
 *   npm run data:download                 # Georgia (europe/georgia), ~100 MB
 *   node pipelines/osm/download.mjs europe/georgia --force
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const REGIONS = { ge: 'europe/georgia' };
const arg = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'ge';
const region = REGIONS[arg] ?? arg;
const force = process.argv.includes('--force');
const name = `${region.split('/').at(-1)}-latest.osm.pbf`;
const url = `https://download.geofabrik.de/${region}-latest.osm.pbf`;
const dest = `data/raw/${name}`;

mkdirSync('data/raw', { recursive: true });
const md5Res = await fetch(`${url}.md5`);
if (!md5Res.ok) throw new Error(`no checksum for ${region} (${md5Res.status}) — is the region name right? see https://download.geofabrik.de`);
const expected = (await md5Res.text()).trim().split(/\s+/)[0];

const md5 = (path) => createHash('md5').update(readFileSync(path)).digest('hex');
if (!force && existsSync(dest) && md5(dest) === expected) {
  console.log(`${dest} is current (${(statSync(dest).size / 1e6).toFixed(0)} MB, md5 ${expected})`);
  process.exit(0);
}

console.log(`downloading ${url} …`);
const res = await fetch(url);
if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
const tmp = `${dest}.part`;
await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
const got = md5(tmp);
if (got !== expected) throw new Error(`checksum mismatch: got ${got}, expected ${expected} — try again`);
renameSync(tmp, dest);
console.log(`${dest}: ${(statSync(dest).size / 1e6).toFixed(0)} MB, md5 ok, data of ${res.headers.get('last-modified') ?? 'unknown date'}`);
