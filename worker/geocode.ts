import { ftsQuery, parseNear, rerank, type GeoRow } from '../src/api/geocode';
import { json } from './http';

/**
 * GET /api/v1/geocode?q=&lang=en|ru&near=lon,lat&limit= — search and suggestions from OUR index (DP-4.4): the
 * region's settlements, named places, streets and addresses in D1 with FTS5 (`pipelines/osm/geocode.mjs`).
 * No third party sees the search text; nothing is stored or logged. 503 when the index isn't loaded
 * (`npm run db:geo:local` on localhost) — the client then uses its fallback.
 */

export interface GeocodeEnv {
  GEO?: D1Database;
  GEOCODE_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

export async function geocode(request: Request, url: URL, env: GeocodeEnv): Promise<Response> {
  if (request.method !== 'GET') return json({ error: 'method-not-allowed' }, 405);
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  if (env.GEOCODE_LIMITER && !(await env.GEOCODE_LIMITER.limit({ key: ip })).success) return json({ error: 'too-many-requests' }, 429);
  const q = (url.searchParams.get('q') ?? '').slice(0, 100);
  const lang = url.searchParams.get('lang') === 'ru' ? 'ru' : 'en';
  const limit = Math.max(1, Math.min(10, Number(url.searchParams.get('limit')) || 6));
  const near = parseNear(url.searchParams.get('near'));
  const match = ftsQuery(q);
  if (!match) return json({ places: [] });
  if (!env.GEO) return json({ error: 'unavailable' }, 503);
  try {
    const { results } = await env.GEO.prepare(
      `SELECT g.id, g.kind, g.rank, g.lat, g.lon, g.name_en, g.name_ru, g.ctx_en, g.ctx_ru, bm25(geo_fts, 10.0, 2.0) AS s
         FROM geo_fts JOIN geo g ON g.rowid = geo_fts.rowid
        WHERE geo_fts MATCH ?1
        ORDER BY s - g.rank * 0.1
        LIMIT 60`,
    )
      .bind(match)
      .all<GeoRow>();
    return json({ places: rerank(results, q, near, lang, limit) });
  } catch {
    // No such table: the index isn't loaded here.
    return json({ error: 'unavailable' }, 503);
  }
}
