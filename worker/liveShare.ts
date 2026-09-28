import { DurableObject } from 'cloudflare:workers';
import {
  mergeUpdate,
  MIN_UPDATE_INTERVAL_MS,
  needsRoute,
  sanitizeUpdate,
  MAX_BODY_BYTES,
  type ServerMessage,
  type ShareSnapshot,
  type ShareState,
} from '../src/share/protocol';
import { json, readJson, sha256Hex, timingSafeEqual } from './http';

interface Meta {
  keyHash: string;
  startedAt: number;
  expiresAt: number;
  name?: string;
}

const MAX_VIEWERS = 50;
/** Persist the latest position at most this often (it is also kept in memory). */
const PERSIST_EVERY_MS = 15_000;
const EMPTY: ShareState = { pos: null, trip: null, sim: false, updatedAt: null };

/**
 * One live share. Holds the sharer's LATEST position only and fans it out to
 * viewers over hibernatable WebSockets. Everything is deleted when the share
 * is stopped or expires (alarm).
 */
export class LiveShare extends DurableObject {
  private state: ShareState | null = null;
  private meta: Meta | null = null;
  private lastPutAt = 0;
  private lastPersistAt = 0;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();

    if (url.pathname === '/init' && request.method === 'POST') {
      if (await this.ctx.storage.get('meta')) return json({ error: 'exists' }, 409);
      const meta = (await request.json()) as Meta;
      await this.ctx.storage.put('meta', meta);
      await this.ctx.storage.setAlarm(meta.expiresAt);
      this.meta = meta;
      this.state = { ...EMPTY };
      return json({ ok: true }, 201);
    }

    // Read the body before any state is examined: nothing below may be
    // interleaved with a stop/expiry that happens while an upload is slow.
    const body = request.method === 'PUT' ? await readJson(request, MAX_BODY_BYTES) : undefined;

    const meta = await this.loadMeta();
    if (!meta) {
      // Backstop: never leave a position behind without a live share.
      if (await this.ctx.storage.get('state')) await this.ctx.storage.deleteAll();
      return json({ error: 'not-found' }, 404);
    }
    if (meta.expiresAt <= now) {
      await this.end();
      return json({ error: 'not-found' }, 404);
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'expected-websocket' }, 426);
      if (this.ctx.getWebSockets().length >= MAX_VIEWERS) return json({ error: 'too-many-viewers' }, 429);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ type: 'snapshot', snapshot: this.snapshot(meta, await this.loadState()) } satisfies ServerMessage));
      return new Response(null, { status: 101, webSocket: client });
    }

    switch (request.method) {
      case 'GET':
        return json(this.snapshot(meta, await this.loadState()));

      case 'PUT': {
        if (!(await this.authorized(request, meta))) return json({ error: 'forbidden' }, 403);
        // Stopped or expired while we were verifying? Then there is nothing to update.
        if (this.meta !== meta) return json({ error: 'not-found' }, 404);
        if (now - this.lastPutAt < MIN_UPDATE_INTERVAL_MS) return json({ error: 'too-fast' }, 429);
        this.lastPutAt = now; // before any await: parallel PUTs can't all pass
        if (body === undefined) return json({ error: 'bad-request' }, 400);
        const update = sanitizeUpdate(body, now);
        if (!update) return json({ error: 'bad-request' }, 400);
        const prev = await this.loadState();
        if (this.meta !== meta) return json({ error: 'not-found' }, 404);
        // A delayed request must not move the marker backwards in time.
        if (prev.pos && update.pos.t < prev.pos.t) return json({ ok: true, stale: true, needsRoute: needsRoute(prev), expiresAt: meta.expiresAt });
        const next = mergeUpdate(prev, update, now);
        this.state = next;
        const routeChanged = next.trip?.routeId !== prev.trip?.routeId || (!!next.trip?.route && !prev.trip?.route) || !next.trip !== !prev.trip;
        if (routeChanged || now - this.lastPersistAt >= PERSIST_EVERY_MS) {
          this.lastPersistAt = now;
          await this.ctx.storage.put('state', next);
        }
        this.broadcast({ type: 'snapshot', snapshot: this.snapshot(meta, next) });
        return json({ ok: true, needsRoute: needsRoute(next), expiresAt: meta.expiresAt });
      }

      case 'DELETE':
        if (!(await this.authorized(request, meta))) return json({ error: 'forbidden' }, 403);
        await this.end();
        return json({ ok: true });

      default:
        return json({ error: 'method-not-allowed' }, 405);
    }
  }

  async alarm(): Promise<void> {
    await this.end();
  }

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    // Keep-alives are answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async webSocketMessage(): Promise<void> {
    // Viewers are read-only; anything they send is ignored.
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  private async loadMeta(): Promise<Meta | null> {
    if (!this.meta) this.meta = (await this.ctx.storage.get<Meta>('meta')) ?? null;
    return this.meta;
  }

  private async loadState(): Promise<ShareState> {
    if (!this.state) this.state = (await this.ctx.storage.get<ShareState>('state')) ?? { ...EMPTY };
    return this.state;
  }

  private async authorized(request: Request, meta: Meta): Promise<boolean> {
    const auth = request.headers.get('Authorization') ?? '';
    const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!key || key.length > 128) return false;
    return timingSafeEqual(await sha256Hex(key), meta.keyHash);
  }

  private snapshot(meta: Meta, s: ShareState): ShareSnapshot {
    return { v: 1, name: meta.name, pos: s.pos, trip: s.trip, sim: s.sim, startedAt: meta.startedAt, expiresAt: meta.expiresAt, updatedAt: s.updatedAt };
  }

  private broadcast(msg: ServerMessage) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        /* socket closing */
      }
    }
  }

  /** Stop: tell viewers, disconnect them, and delete everything. */
  private async end() {
    this.broadcast({ type: 'ended' });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1000, 'ended');
      } catch {
        /* already closed */
      }
    }
    this.meta = null;
    this.state = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}
