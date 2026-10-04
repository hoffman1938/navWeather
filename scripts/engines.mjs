#!/usr/bin/env node
/**
 * Our engines on localhost, in Docker (DEVELOPMENT_PLAN DP-2.4; Colima or Docker Desktop). Today: Valhalla
 * (routing for car, walking, cycling), built from the region's OSM extract on first start (~1 min for Georgia).
 *
 *   npm run engines:up       start (and build the graph if needed); writes VALHALLA_URL into .dev.vars
 *   npm run engines:down     stop
 *   npm run engines:status
 *
 * The local Worker reads .dev.vars when it starts: restart `npm run dev` after the first `engines:up`.
 * Without Docker the app still works: routing then uses the public OSRM servers (VITE_ROUTING_FALLBACK).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, linkSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const IMAGE = 'ghcr.io/valhalla/valhalla-scripted:latest';
const NAME = 'navweather-valhalla';
const PORT = 8002;
const URL_ = `http://127.0.0.1:${PORT}`;
const PBF = 'data/raw/georgia-latest.osm.pbf';
const DIR = resolve('data/build/valhalla');

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

async function up() {
  if (docker('info').status !== 0) {
    console.error('Docker is not running. Start it (`colima start`, or Docker Desktop) and try again.');
    process.exit(1);
  }
  if (!existsSync(PBF)) {
    console.error(`${PBF} is missing — run \`npm run data:download\` first.`);
    process.exit(1);
  }
  mkdirSync(DIR, { recursive: true });
  const pbfCopy = join(DIR, 'georgia-latest.osm.pbf');
  if (!existsSync(pbfCopy)) {
    try {
      linkSync(PBF, pbfCopy);
    } catch {
      copyFileSync(PBF, pbfCopy);
    }
  }
  const running = docker('ps', '-q', '-f', `name=^${NAME}$`).stdout.trim();
  if (!running) {
    docker('rm', '-f', NAME);
    if (docker('image', 'inspect', IMAGE).status !== 0) {
      console.log(`pulling ${IMAGE} (~160 MB) …`);
      const pull = spawnSync('docker', ['pull', IMAGE], { env, stdio: 'inherit' });
      if (pull.status !== 0) process.exit(1);
    }
    const run = docker(
      'run', '-d', '--name', NAME, '-p', `127.0.0.1:${PORT}:8002`, '-v', `${DIR}:/custom_files`,
      '-e', 'use_tiles_ignore_pbf=True', '-e', 'build_admins=True', '-e', 'build_time_zones=False', '-e', 'build_elevation=False',
      '-e', 'server_threads=2', '-e', 'force_rebuild=False', IMAGE,
    );
    if (run.status !== 0) {
      console.error(run.stderr);
      process.exit(1);
    }
    console.log('Valhalla starting (the first start builds the Georgia graph, about a minute) …');
  }
  for (let i = 0; i < 300; i++) {
    try {
      const res = await fetch(`${URL_}/status`);
      if (res.ok) break;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  const ok = await fetch(`${URL_}/status`).then((r) => r.ok).catch(() => false);
  if (!ok) {
    console.error(`Valhalla did not answer on ${URL_} — see \`docker logs ${NAME}\`.`);
    process.exit(1);
  }
  // Tell the local Worker where the engine is (.dev.vars is git-ignored).
  const vars = existsSync('.dev.vars') ? readFileSync('.dev.vars', 'utf8').split('\n').filter((l) => l && !l.startsWith('VALHALLA_URL=')) : [];
  writeFileSync('.dev.vars', [...vars, `VALHALLA_URL=${URL_}`].join('\n') + '\n');
  console.log(`Valhalla ready on ${URL_} (VALHALLA_URL in .dev.vars — restart \`npm run dev\` if it was running).`);
}

function down() {
  docker('rm', '-f', NAME);
  console.log('Valhalla stopped.');
}

async function status() {
  const ok = await fetch(`${URL_}/status`).then((r) => r.json()).catch(() => null);
  console.log(ok ? `Valhalla ${ok.version} on ${URL_}` : 'Valhalla is not running (npm run engines:up).');
}

const cmd = process.argv[2] ?? 'status';
if (cmd === 'up') await up();
else if (cmd === 'down') down();
else await status();
