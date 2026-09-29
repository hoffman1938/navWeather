import { DurableObject } from 'cloudflare:workers';
import {
  applyVote,
  approxDistanceM,
  DEDUPE_M,
  MAX_LIST,
  MAX_REPORT_BODY,
  parseBbox,
  REPORT_ID_RE,
  REPORT_TTL_MIN,
  sanitizeReport,
  sanitizeVote,
  type PublicReport,
  type ReportKind,
} from '../src/reports/protocol';
import { json, randomToken, readJson, sha256Hex } from './http';

const DAY = 86_400_000;
const MAX_PER_REPORTER_PER_DAY = 30;
const MAX_ACTIVE = 50_000;

interface Row extends Record<string, SqlStorageValue> {
  id: string;
  kind: string;
  lat: number;
  lon: number;
  created_at: number;
  expires_at: number;
  confirms: number;
  denies: number;
  reporter: string;
}

function toPublic(r: Row): PublicReport {
  return { id: r.id, kind: r.kind as ReportKind, lat: r.lat, lon: r.lon, createdAt: r.created_at, expiresAt: r.expires_at, confirms: r.confirms, denies: r.denies };
}

/**
 * Driver reports (one SQLite-backed object). Stores what was reported, where
 * and when, plus counts of "still there" / "gone". Reporters and voters are
 * kept only as a salted hash (salt rotated daily, never leaves this object)
 * so floods and double votes can be refused; no IP address is stored.
 * Expired reports and their votes are deleted by an hourly alarm.
 */
export class Reports extends DurableObject {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        confirms INTEGER NOT NULL DEFAULT 0, denies INTEGER NOT NULL DEFAULT 0, reporter TEXT NOT NULL)`,
    );
    this.sql.exec('CREATE INDEX IF NOT EXISTS reports_lat ON reports(lat)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS reports_expires ON reports(expires_at)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS votes (report_id TEXT NOT NULL, voter TEXT NOT NULL, PRIMARY KEY (report_id, voter))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  }

  /** Salted, daily-rotating pseudonym for a client (never the IP itself). */
  private async who(ip: string, now: number): Promise<string> {
    const day = String(Math.floor(now / DAY));
    const row = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = 'salt'").toArray()[0];
    let salt = row?.v.startsWith(`${day}:`) ? row.v.slice(day.length + 1) : null;
    if (!salt) {
      salt = randomToken(24);
      this.sql.exec("INSERT INTO meta (k, v) VALUES ('salt', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", `${day}:${salt}`);
    }
    return (await sha256Hex(`${salt}|${ip}`)).slice(0, 32);
  }

  private async ensureCleanup(now: number) {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(now + 3_600_000);
  }

  async alarm() {
    const now = Date.now();
    this.sql.exec('DELETE FROM votes WHERE report_id IN (SELECT id FROM reports WHERE expires_at <= ?)', now);
    this.sql.exec('DELETE FROM reports WHERE expires_at <= ?', now);
    const left = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM reports').one().n;
    if (left > 0) await this.ctx.storage.setAlarm(now + 3_600_000);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();
    const ip = request.headers.get('x-client-ip') ?? 'local';

    if (url.pathname === '/list' && request.method === 'GET') {
      const b = parseBbox(url.searchParams.get('bbox'));
      if (!b) return json({ error: 'bad-request' }, 400);
      const [w, s, e, n] = b;
      const rows = this.sql
        .exec<Row>(
          'SELECT * FROM reports WHERE expires_at > ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ? ORDER BY created_at DESC LIMIT ?',
          now,
          s,
          n,
          w,
          e,
          MAX_LIST,
        )
        .toArray();
      return json({ reports: rows.map(toPublic), now });
    }

    if (url.pathname === '/create' && request.method === 'POST') {
      const input = sanitizeReport(await readJson(request, MAX_REPORT_BODY));
      if (!input) return json({ error: 'bad-request' }, 400);
      const me = await this.who(ip, now);
      const mine = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM reports WHERE reporter = ? AND created_at > ?', me, now - DAY).one().n;
      if (mine >= MAX_PER_REPORTER_PER_DAY) return json({ error: 'too-many-requests' }, 429);

      // The same thing reported again nearby is a confirmation, not a new report.
      const dLat = 0.0015;
      const dLon = dLat / Math.max(0.2, Math.cos((input.lat * Math.PI) / 180));
      const near = this.sql
        .exec<Row>(
          'SELECT * FROM reports WHERE kind = ? AND expires_at > ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?',
          input.kind,
          now,
          input.lat - dLat,
          input.lat + dLat,
          input.lon - dLon,
          input.lon + dLon,
        )
        .toArray()
        .find((r) => approxDistanceM(r.lat, r.lon, input.lat, input.lon) <= DEDUPE_M);
      if (near) {
        if (near.reporter !== me && this.addVote(near.id, me)) {
          const next = applyVote(toPublic(near), 'still', now);
          this.sql.exec('UPDATE reports SET confirms = ?, expires_at = ? WHERE id = ?', next.confirms, next.expiresAt, near.id);
          return json({ id: near.id, expiresAt: next.expiresAt, merged: true });
        }
        return json({ id: near.id, expiresAt: near.expires_at, merged: true });
      }

      const active = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM reports WHERE expires_at > ?', now).one().n;
      if (active >= MAX_ACTIVE) return json({ error: 'unavailable' }, 503);
      const id = randomToken(12);
      const expiresAt = now + REPORT_TTL_MIN[input.kind] * 60_000;
      this.sql.exec(
        'INSERT INTO reports (id, kind, lat, lon, created_at, expires_at, reporter) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id,
        input.kind,
        input.lat,
        input.lon,
        now,
        expiresAt,
        me,
      );
      await this.ensureCleanup(now);
      return json({ id, expiresAt }, 201);
    }

    const vm = /^\/vote\/([^/]+)$/.exec(url.pathname);
    if (vm && request.method === 'POST') {
      if (!REPORT_ID_RE.test(vm[1])) return json({ error: 'not-found' }, 404);
      const vote = sanitizeVote(await readJson(request, MAX_REPORT_BODY));
      if (!vote) return json({ error: 'bad-request' }, 400);
      const row = this.sql.exec<Row>('SELECT * FROM reports WHERE id = ? AND expires_at > ?', vm[1], now).toArray()[0];
      if (!row) return json({ error: 'not-found' }, 404);
      const me = await this.who(ip, now);
      if (row.reporter === me) return json({ error: 'own-report' }, 409);
      if (!this.addVote(row.id, me)) return json({ error: 'already-voted' }, 409);
      const next = applyVote(toPublic(row), vote, now);
      this.sql.exec('UPDATE reports SET confirms = ?, denies = ?, expires_at = ? WHERE id = ?', next.confirms, next.denies, next.expiresAt, row.id);
      return json({ ...next, active: next.expiresAt > now });
    }

    return json({ error: 'not-found' }, 404);
  }

  /** Record a vote; false when this client already voted on the report. */
  private addVote(reportId: string, voter: string): boolean {
    const before = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM votes WHERE report_id = ? AND voter = ?', reportId, voter).one().n;
    if (before) return false;
    this.sql.exec('INSERT INTO votes (report_id, voter) VALUES (?, ?)', reportId, voter);
    return true;
  }
}
