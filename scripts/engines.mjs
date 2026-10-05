#!/usr/bin/env node
/**
 * Our engines on localhost, in Docker (DEVELOPMENT_PLAN DP-2.4; Colima or Docker Desktop):
 *   Valhalla — roads for car, walking, cycling; the graph is built from the region's OSM extract on first start
 *              (~1 min for Georgia).                              needs `npm run data:download`
 *   MOTIS    — public transport over the region's open timetables, walking legs on OSM streets; imported in seconds.
 *                                                                 needs `npm run data:transit` (and the OSM extract)
 *
 *   npm run engines:up       start what has its data (building/importing if needed); writes VALHALLA_URL and
 *                            MOTIS_URL into .dev.vars
 *   npm run engines:down     stop both
 *   npm run engines:status
 *
 * The local Worker reads .dev.vars when it starts: restart `npm run dev` after the first `engines:up`.
 * Without Docker the app still works: routing then uses the public OSRM servers (VITE_ROUTING_FALLBACK), public
 * transport Transitous (VITE_TRANSIT_FALLBACK_URL).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const PBF = 'data/raw/georgia-latest.osm.pbf';
const GTFS_DIR = 'data/raw/gtfs';

/**
 * A leftover Docker Desktop setting (`credsStore: desktop`) makes public pulls fail when Docker Desktop is gone;
 * use a clean config for our commands then (the user's own config is left alone).
 */
function dockerEnv() {
  const env = { ...process.env };
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), '.docker', 'config.json'), 'utf8'));
    const helper = cfg.credsStore ? `docker-credential-${cfg.credsStore}` : null;
    if (helper && spawnSync('which', [helper]).status !== 0) {
      const dir = resolve('data/build/docker-config');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'config.json'), JSON.stringify({ auths: {}, currentContext: cfg.currentContext }));
      if (existsSync(join(homedir(), '.docker', 'contexts'))) execFileSync('cp', ['-R', join(homedir(), '.docker', 'contexts'), dir]);
      env.DOCKER_CONFIG = dir;
    }
  } catch {
    /* no config: defaults are fine */
  }
  return env;
}
const env = dockerEnv();
const docker = (...args) => spawnSync('docker', args, { env, encoding: 'utf8' });
const dockerLoud = (...args) => spawnSync('docker', args, { env, stdio: 'inherit' });

/** A hard link (or a copy) of `src` in `dir`, refreshed when the source is newer. */
function place(src, dir) {
  const dst = join(dir, src.split('/').pop());
  if (existsSync(dst) && statSync(dst).mtimeMs >= statSync(src).mtimeMs && statSync(dst).size === statSync(src).size) return dst;
  try {
    if (existsSync(dst)) spawnSync('rm', ['-f', dst]);
    linkSync(src, dst);
  } catch {
    copyFileSync(src, dst);
  }
  return dst;
}

function pull(image, mb) {
  if (docker('image', 'inspect', image).status === 0) return;
  console.log(`pulling ${image} (~${mb} MB) …`);
  if (dockerLoud('pull', image).status !== 0) process.exit(1);
}

async function waitFor(url, label, tries = 300) {
  for (let i = 0; i < tries; i++) {
    if (await fetch(url).then((r) => r.ok, () => false)) return true;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.error(`${label} did not answer on ${url}.`);
  return false;
}

const ENGINES = [
  {
    key: 'valhalla',
    label: 'Valhalla',
    image: 'ghcr.io/valhalla/valhalla-scripted:latest',
    mb: 160,
    name: 'navweather-valhalla',
    port: 8002,
    health: '/status',
    envVar: 'VALHALLA_URL',
    ready: () => existsSync(PBF) || `${PBF} is missing — run \`npm run data:download\` first.`,
    start(dir) {
      place(PBF, dir);
      return docker(
        'run', '-d', '--name', this.name, '-p', `127.0.0.1:${this.port}:8002`, '-v', `${dir}:/custom_files`,
        '-e', 'use_tiles_ignore_pbf=True', '-e', 'build_admins=True', '-e', 'build_time_zones=False', '-e', 'build_elevation=False',
        '-e', 'server_threads=2', '-e', 'force_rebuild=False', this.image,
      );
    },
    starting: 'Valhalla starting (the first start builds the Georgia graph, about a minute) …',
  },
  {
    key: 'motis',
    label: 'MOTIS',
    image: 'ghcr.io/motis-project/motis:latest',
    mb: 70,
    name: 'navweather-motis',
    port: 8081,
    health: '/',
    envVar: 'MOTIS_URL',
    feeds: () => (existsSync(GTFS_DIR) ? readdirSync(GTFS_DIR).filter((f) => f.endsWith('.gtfs.zip')).map((f) => join(GTFS_DIR, f)) : []),
    ready() {
      if (!existsSync(PBF)) return `${PBF} is missing — run \`npm run data:download\` first.`;
      return this.feeds().length > 0 || 'no timetables — run `npm run data:transit` first.';
    },
    start(dir) {
      const inputs = [place(PBF, dir), ...this.feeds().map((f) => place(f, dir))];
      const names = inputs.map((p) => p.split('/').pop());
      const newest = Math.max(...inputs.map((p) => statSync(p).mtimeMs));
      const run = (...args) => dockerLoud('run', '--rm', '-v', `${dir}:/data`, '-w', '/data', this.image, '/motis', ...args).status === 0;
      // Our config: MOTIS's map tiles and geocoder off (we have our own) — a smaller, faster import.
      if (!existsSync(join(dir, 'config.yml')) || statSync(join(dir, 'config.yml')).mtimeMs < newest) {
        if (!run('config', ...names)) process.exit(1);
        const cfg = readFileSync(join(dir, 'config.yml'), 'utf8')
          .replace(/tiles:\n( {2}.*\n)+/, '')
          .replace('reverse_geocoding: true', 'reverse_geocoding: false')
          .replace(/^geocoding: true$/m, 'geocoding: false');
        writeFileSync(join(dir, 'config.yml'), cfg);
      }
      const marker = join(dir, 'data', '.imported');
      if (!existsSync(marker) || statSync(marker).mtimeMs < newest) {
        console.log('MOTIS: importing the timetables and streets …');
        if (!run('import')) process.exit(1);
        writeFileSync(marker, new Date().toISOString());
      }
      return docker('run', '-d', '--name', this.name, '-p', `127.0.0.1:${this.port}:8080`, '-v', `${dir}:/data`, '-w', '/data', this.image, '/motis', 'server');
    },
    starting: 'MOTIS starting …',
  },
];

function writeVars(pairs) {
  const keys = Object.keys(pairs);
  const vars = existsSync('.dev.vars') ? readFileSync('.dev.vars', 'utf8').split('\n').filter((l) => l && !keys.some((k) => l.startsWith(`${k}=`))) : [];
  writeFileSync('.dev.vars', [...vars, ...Object.entries(pairs).map(([k, v]) => `${k}=${v}`)].join('\n') + '\n');
}

async function up() {
  if (docker('info').status !== 0) {
    console.error('Docker is not running. Start it (`colima start`, or Docker Desktop) and try again.');
    process.exit(1);
  }
  const vars = {};
  for (const e of ENGINES) {
    const ready = e.ready();
    if (ready !== true) {
      console.log(`${e.label}: skipped — ${ready}`);
      continue;
    }
    const dir = resolve(`data/build/${e.key}`);
    mkdirSync(dir, { recursive: true });
    if (!docker('ps', '-q', '-f', `name=^${e.name}$`).stdout.trim()) {
      docker('rm', '-f', e.name);
      pull(e.image, e.mb);
      const r = e.start(dir);
      if (r.status !== 0) {
        console.error(r.stderr);
        process.exit(1);
      }
      console.log(e.starting);
    }
    const url = `http://127.0.0.1:${e.port}`;
    if (!(await waitFor(`${url}${e.health}`, e.label))) {
      console.error(`see \`docker logs ${e.name}\``);
      process.exit(1);
    }
    vars[e.envVar] = url;
    console.log(`${e.label} ready on ${url}`);
  }
  // Tell the local Worker where the engines are (.dev.vars is git-ignored).
  if (Object.keys(vars).length) {
    writeVars(vars);
    console.log(`${Object.keys(vars).join(', ')} in .dev.vars — restart \`npm run dev\` if it was running.`);
  }
}

function down() {
  for (const e of ENGINES) docker('rm', '-f', e.name);
  console.log('Engines stopped.');
}

async function status() {
  for (const e of ENGINES) {
    const url = `http://127.0.0.1:${e.port}`;
    const okay = await fetch(`${url}${e.health}`).then((r) => r.ok, () => false);
    console.log(`${e.label}: ${okay ? `running on ${url}` : 'not running (npm run engines:up)'}`);
  }
}

const cmd = process.argv[2] ?? 'status';
if (cmd === 'up') await up();
else if (cmd === 'down') down();
else await status();
