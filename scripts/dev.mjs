#!/usr/bin/env node
/**
 * `npm run dev` — the whole app on localhost with one command (REQ-DEV-001):
 *   - the Worker (live sharing, driver reports, approximate location, Long Trip planner) on
 *     http://127.0.0.1:8787 with local Durable Objects and rate limits (`wrangler dev`, no Cloudflare account);
 *   - the Vite dev server on http://localhost:5173, which proxies /api to the Worker (vite.config.ts).
 *
 * Extra arguments go to Vite (`npm run dev -- --port 5174`). If a Worker already answers on :8787
 * (`npm run dev:api` in another terminal), it is reused. Ctrl+C stops both.
 * Only the app: `npm run dev:web`. Only the Worker: `npm run dev:api`.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const API = 'http://127.0.0.1:8787/api/v1/health';
const children = [];
let stopping = false;

function run(name, color, cmd, args) {
  const child = spawn(cmd, args, { stdio: ['inherit', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '1' } });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (from, to) => {
    let rest = '';
    from.on('data', (chunk) => {
      const lines = (rest + chunk.toString()).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) to.write(tag + line + '\n');
    });
    from.on('end', () => rest && to.write(tag + rest + '\n'));
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`${tag}stopped (${signal ?? `exit ${code}`}) — stopping the rest.`);
    stop(code ?? 1);
  });
  children.push(child);
  return child;
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500).unref();
}

async function apiRunning() {
  try {
    const res = await fetch(API, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForApi(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await apiRunning()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

if (await apiRunning()) {
  console.log('\x1b[36m[api]\x1b[0m a Worker already answers on :8787 — using it');
} else {
  // The Worker serves dist/ as its assets; it only has to exist in development.
  mkdirSync('dist', { recursive: true });
  run('api', 36, npx, ['wrangler', 'dev', '--port', '8787', '--ip', '127.0.0.1']);
  // Vite can start meanwhile; say clearly when the API is (not) there.
  void waitForApi(60_000).then((ok) =>
    console.log(ok ? '\x1b[36m[api]\x1b[0m ready on http://127.0.0.1:8787 (proxied as /api)' : '\x1b[36m[api]\x1b[0m not answering yet — sharing, reports and Long Trip plans need it'),
  );
}
run('web', 35, npx, ['vite', ...process.argv.slice(2)]);
