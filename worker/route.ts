import { routeErrorOf, sanitizeMatrixRequest, sanitizeRouteRequest, valhallaMatrixRequest, valhallaRouteRequest } from '../src/api/route';
import { json, readJson } from './http';

/**
 * POST /api/v1/route, POST /api/v1/route/matrix — our routing engine (Valhalla, DEVELOPMENT_PLAN DP-5.2) behind
 * the Worker: validation, a per-client rate limit, and errors in our API's words. The engine runs in Docker on
 * localhost (`npm run engines:up` → VALHALLA_URL) and in Cloudflare Containers once Workers Paid is on (DP-5.1);
 * without it the answer is 503 and the app uses its fallback router. Nothing is stored or logged.
 */

export interface RouteEnv {
  /** Where our Valhalla answers (local Docker; later the container's address). Unset → 503. */
  VALHALLA_URL?: string;
  ROUTE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

/** The engine's answer, or null when there is no engine (not configured, not running, no answer in time). */
async function engine(env: RouteEnv, path: string, body: unknown): Promise<Response | null> {
  const base = (env.VALHALLA_URL ?? '').replace(/\/$/, '');
  if (!base) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    return await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function guard(request: Request, env: RouteEnv, maxBytes: number): Promise<Response | unknown> {
  if (request.method !== 'POST') return json({ error: 'method-not-allowed' }, 405);
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return json({ error: 'unsupported-media-type' }, 415);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (env.ROUTE_LIMITER && !(await env.ROUTE_LIMITER.limit({ key: ip })).success) return json({ error: 'too-many-requests' }, 429);
  const body = await readJson(request, maxBytes);
  return body === undefined ? json({ error: 'bad-request' }, 400) : body;
}

export async function route(request: Request, env: RouteEnv): Promise<Response> {
  const body = await guard(request, env, 8_000);
  if (body instanceof Response) return body;
  const req = sanitizeRouteRequest(body);
  if (!req) return json({ error: 'bad-request' }, 400);
  const res = await engine(env, '/route', valhallaRouteRequest(req));
  if (!res) return json({ error: 'unavailable' }, 503);
  const data = (await res.json().catch(() => null)) as { code?: string; error_code?: number; routes?: unknown[] } | null;
  if (!res.ok || data?.code !== 'Ok' || !data.routes?.length) {
    const { status, error } = routeErrorOf(data);
    return json({ error }, status);
  }
  return json(data);
}

export async function routeMatrix(request: Request, env: RouteEnv): Promise<Response> {
  const body = await guard(request, env, 16_000);
  if (body instanceof Response) return body;
  const req = sanitizeMatrixRequest(body);
  if (!req) return json({ error: 'bad-request' }, 400);
  const res = await engine(env, '/sources_to_targets', valhallaMatrixRequest(req));
  if (!res) return json({ error: 'unavailable' }, 503);
  const data = (await res.json().catch(() => null)) as { sources_to_targets?: { time: number | null; distance: number | null }[][] } | null;
  if (!res.ok || !data?.sources_to_targets) return json({ error: 'engine-error' }, 502);
  return json({
    durations: data.sources_to_targets.map((row) => row.map((c) => c.time)),
    // Valhalla answers kilometres; the app (like OSRM) works in metres.
    distances: data.sources_to_targets.map((row) => row.map((c) => (c.distance === null ? null : Math.round(c.distance * 1000)))),
  });
}
