import { apiPaths } from '../../api/v1';
import { MAX_BBOX_AREA, type PublicReport, type ReportKind, type Vote } from '../../reports/protocol';
import type { LngLat } from '../../types/geo';
import type { Route } from '../../types/route';
import { fetchJson, isAbortError, mapWithConcurrency, ProviderError } from '../http';
import type { Incident, IncidentProvider } from './IncidentProvider';

export type Bbox = [west: number, south: number, east: number, north: number];

/** How much a report of each kind matters to a driver (drives alert timing). */
const SEVERITY: Record<ReportKind, Incident['severity']> = {
  accident: 'high',
  closure: 'high',
  hazard: 'high',
  roadworks: 'medium',
  weather: 'medium',
};

/** Boxes per route; very long routes get larger boxes instead of more requests. */
const MAX_BOXES = 24;
/** ~130 km boxes (well inside the relay's area limit). */
const BASE_SPAN_DEG = 1.2;
/** Reports up to ~1 km beside the line are still fetched (snapping decides later). */
const PAD_DEG = 0.01;

/**
 * Cover a route with a few small boxes that follow the line (one box around
 * a long diagonal route would cover a huge empty area — and the relay caps
 * the area per request). Every vertex lies inside at least one box.
 */
export function routeBoxes(geometry: LngLat[], maxBoxes = MAX_BOXES): Bbox[] {
  if (!geometry.length) return [];
  const maxSpan = Math.sqrt(MAX_BBOX_AREA) - 2 * PAD_DEG - 0.01;
  for (let span = BASE_SPAN_DEG; ; span = Math.min(maxSpan, span * 1.5)) {
    const boxes = chunk(geometry, span);
    if (boxes.length <= maxBoxes || span >= maxSpan) return boxes;
  }
}

function chunk(geometry: LngLat[], span: number): Bbox[] {
  const boxes: Bbox[] = [];
  let [w, s] = geometry[0];
  let [e, n] = geometry[0];
  const close = () => boxes.push([round(w - PAD_DEG), round(s - PAD_DEG), round(e + PAD_DEG), round(n + PAD_DEG)]);
  for (let i = 1; i < geometry.length; i++) {
    const [x, y] = geometry[i];
    const nw = Math.min(w, x);
    const ne = Math.max(e, x);
    const ns = Math.min(s, y);
    const nn = Math.max(n, y);
    if (ne - nw > span || nn - ns > span) {
      close();
      // The next box starts at the previous vertex, so no stretch of road falls between boxes.
      const [px, py] = geometry[i - 1];
      w = Math.min(px, x);
      e = Math.max(px, x);
      s = Math.min(py, y);
      n = Math.max(py, y);
    } else {
      w = nw;
      e = ne;
      s = ns;
      n = nn;
    }
  }
  close();
  return boxes;
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/** A relay report as a (never verified) incident; times moved onto this device's clock. */
export function reportToIncident(r: PublicReport, skewMs: number): Incident {
  return {
    id: `report:${r.id}`,
    reportId: r.id,
    kind: r.kind,
    coordinate: [r.lon, r.lat],
    severity: SEVERITY[r.kind] ?? 'medium',
    verified: false,
    source: 'reports',
    reportedAt: r.createdAt + skewMs,
    expiresAt: r.expiresAt + skewMs,
    confirmations: r.confirms,
  };
}

function isPublicReport(x: unknown): x is PublicReport {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.kind === 'string' &&
    Number.isFinite(r.lat) &&
    Number.isFinite(r.lon) &&
    Number.isFinite(r.createdAt) &&
    Number.isFinite(r.expiresAt) &&
    typeof r.confirms === 'number'
  );
}

/**
 * DRIVER REPORTS through the app's own relay (`/api/v1/reports`, a Cloudflare
 * Worker + Durable Object — see worker/reports.ts). Reports are unverified:
 * the route engine labels them "reported", never as fact.
 */
export class ReportsIncidentProvider implements IncidentProvider {
  readonly name = 'reports';

  constructor(
    private baseUrl: string = apiPaths.reports,
    private timeoutMs = 10_000,
  ) {}

  private get base() {
    return this.baseUrl.replace(/\/$/, '');
  }

  async getIncidents(route: Route, signal?: AbortSignal): Promise<Incident[]> {
    const boxes = routeBoxes(route.geometry);
    let failures = 0;
    let lastError: unknown = null;
    const lists = await mapWithConcurrency(boxes, 3, async (b) => {
      try {
        const data = await fetchJson<{ reports?: unknown[]; now?: number }>(`${this.base}?bbox=${b.join(',')}`, {
          provider: 'Driver reports',
          signal,
          timeoutMs: this.timeoutMs,
        });
        if (!data || !Array.isArray(data.reports)) throw new ProviderError('Unexpected reports response', 'invalid-response', 'Driver reports');
        const skew = typeof data.now === 'number' && Number.isFinite(data.now) ? Date.now() - data.now : 0;
        return data.reports.filter(isPublicReport).map((r) => reportToIncident(r, skew));
      } catch (e) {
        if (isAbortError(e)) throw e;
        failures++;
        lastError = e;
        return [];
      }
    });
    // Some boxes answering is still useful; none answering means the service is down.
    if (boxes.length && failures === boxes.length) throw lastError;
    const byId = new Map<string, Incident>();
    for (const inc of lists.flat()) byId.set(inc.id, inc);
    return [...byId.values()];
  }

  async report(kind: ReportKind, [lon, lat]: LngLat, signal?: AbortSignal): Promise<{ id: string; expiresAt: number }> {
    const res = await fetchJson<{ id?: unknown; expiresAt?: unknown }>(this.base, {
      provider: 'Driver reports',
      signal,
      timeoutMs: this.timeoutMs,
      init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, lat, lon }) },
    });
    if (typeof res?.id !== 'string' || typeof res.expiresAt !== 'number') {
      throw new ProviderError('Unexpected reports response', 'invalid-response', 'Driver reports');
    }
    return { id: res.id, expiresAt: res.expiresAt };
  }

  async vote(reportId: string, vote: Vote, signal?: AbortSignal): Promise<{ active: boolean }> {
    const res = await fetchJson<{ active?: unknown }>(`${this.base}/${encodeURIComponent(reportId)}/vote`, {
      provider: 'Driver reports',
      signal,
      timeoutMs: this.timeoutMs,
      init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vote }) },
    });
    return { active: res?.active !== false };
  }
}

export type ReportFailure = 'offline' | 'busy' | 'unavailable' | 'gone' | 'refused';

/** What went wrong, in terms the driver can act on. */
export function reportFailure(e: unknown): ReportFailure {
  if (e instanceof ProviderError) {
    if (e.kind === 'network' || e.kind === 'timeout') return 'offline';
    if (e.kind === 'rate-limited') return 'busy';
    if (e.kind === 'http' && e.status === 404) return 'gone';
    if (e.kind === 'http' && e.status === 409) return 'refused';
  }
  return 'unavailable';
}
