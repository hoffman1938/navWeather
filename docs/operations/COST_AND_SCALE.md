# Cost control and scalability model

All numbers are **ESTIMATES** from the request patterns in the code
(2026-10-02) unless marked **KNOWN** (verified list price) or
**PROVIDER-DEPENDENT** (price not published / not verified). Cloudflare list
prices verified 2026-10-02 at developers.cloudflare.com.

## 1. Request pattern per daily active user (DAU)

Two profiles: **planner** (70 % of DAU: 2 route plans, 4 place/chip
lookups, 1 weather-layer area) and **driver** (30 %: 1 plan + 2 h of real
navigation with reports on). Live sharing: 2 % of DAU share for 1 h.

| Source | What triggers calls | Planner/day | Driver/day | Blended/DAU |
| --- | --- | --- | --- | --- |
| **Open-Meteo** (weighted calls: 14 variables ⇒ ×1.4 per location; per-location counting **REQUIRES VERIFICATION**) | plan ≈ 70 locations (3 roads + refinement) ≈ 98; place/chip ≈ 2.4; layer 49 loc ≈ 69; driving refresh every 20 min ≈ 70 each | ≈ 275 | ≈ 520 | **≈ 350** |
| **Routing** (OSRM public) | plan = 1 + ≤4 via probes; detour table; re-routes; weather-reroute check every 10 min driving | ≈ 11 | ≈ 20 | **≈ 14** |
| **Geocoding** (Photon, Nominatim) | autocomplete (300 ms debounce), submit, naming display points | ≈ 35 | ≈ 20 | **≈ 30** |
| **Overpass** | places per plan; limits/cameras/crossings per drive; POI search | ≈ 3 | ≈ 5 | **≈ 3.5** |
| **Worker API** (today) | report boxes ≤24 per load, refresh every 5 min driving; live share PUT every ≥5 s | ≈ 20 | ≈ 250 | **≈ 105** |
| **Worker API** (after REQ-CF-009 corridor request) | one request per load/refresh | ≈ 2 | ≈ 25 | **≈ 25** |
| **Long Trip Mode** (drivers on LONG trips, est. 10 % of drivers) | 1 plan + ≤1 replan per hour driving + 1–4 stop-places + 1 borders call | — | ≈ 5–8 Worker requests; ≈ 2–5 Overpass queries (edge-cached by area) | **≈ 0.5** |
| Static assets | page loads | free (KNOWN: not billed) | | |
| Map tiles | OpenFreeMap CDN (not our bill) | ~100–300 tile requests per session | | |

## 2. Why the architecture must change before growth

**Open-Meteo, client-direct (today):** ≈350 calls/DAU. The free tier is
"less than 10,000 API calls per day" for non-commercial use — at **~30 DAU
the app as a whole exceeds it** even though each user's browser stays far
below. Relying on per-IP enforcement would breach the spirit of the terms →
**REQUIRES REVIEW with Open-Meteo**; plan the paid key + edge cache for the
private beta, not only for commercial launch (ADR-005 updated).

**With the shared edge cache** (Cache API per PoP → KV → Open-Meteo, keyed by
0.02° cell + model run, TTL until the next model run):
upstream calls ≈ distinct cells touched × model updates per day × 1.4,
independent of user count once cells are warm. Georgia ≈ 19,000 cells in
total; trips realistically touch 2,000–5,000/day.

| Refresh policy | Upstream calls/day (5,000 cells) | Per month |
| --- | --- | --- |
| hourly TTL | 5,000 × 24 × 1.4 ≈ 168,000 | ≈ 5.0M (Professional-size) |
| per model run (~3 h) | 5,000 × 8 × 1.4 ≈ 56,000 | ≈ 1.7M |
| per model run, ≤10 variables | 5,000 × 8 × 1.0 ≈ 40,000 | ≈ 1.2M (≈ Standard-size) |

Plan prices: **PROVIDER-DEPENDENT** (allowances verified: Standard 1M,
Professional 5M, Enterprise >50M calls/month).

## 3. Scale table (per day unless noted)

| Metric | 1 DAU | 1,000 | 10,000 | 100,000 | 1,000,000 |
| --- | --- | --- | --- | --- | --- |
| Worker API requests (today, 105/DAU) | 105 | 105k | 1.05M | 10.5M | 105M |
| Worker API requests (after corridor fix, 25/DAU) | 25 | 25k | 250k | 2.5M | 25M |
| Workers plan | Free | Free (after fix) | Paid | Paid | Paid |
| Reports DO load, avg (after fix ≈ 9/DAU) | — | 0.1 req/s | 1 req/s | 10 req/s | ≈ 104 req/s avg, peaks ~500 → **shard** (soft limit 1,000 req/s per object) |
| Reports DO load, avg (today ≈ 89/DAU) | — | 1 req/s | 10 req/s | 100 req/s | ≈ 1,030 req/s → **over the limit** |
| Open-Meteo direct (350/DAU) | 350 | 350k | 3.5M | 35M | 350M |
| Open-Meteo via edge cache (Georgia-scale, model-run TTL) | 350 | ≤ 56k | ≤ 56k | ≤ 56k | international: ~0.5–2M (cells × runs) → Enterprise or self-hosted |
| Routing requests (14/DAU) | 14 | 14k | 140k (1.6/s) | 1.4M (16/s, peaks ~80/s) | 14M (160/s, peaks ~800/s) |
| Geocoding (30/DAU) | 30 | 30k | 300k | 3M (35/s) | 30M (350/s) |
| D1 rows read (10 % signed in, ~10 rows/request, ~20 req) | — | 20k | 200k | 2M | 20M (Free 5M/day; Paid 25B/month included) |

Public services' limits (KNOWN): OSRM demo and FOSSGIS 1 req/s per user and
non-commercial; Nominatim 1 req/s and no heavy use; Overpass "regular
application" guidance ~100 queries/day. **From ~1,000 DAU these are not
appropriate** → self-hosted routing/geocoding/OSM extracts (ADR-004).

## 4. Monthly cost estimates (Cloudflare KNOWN unit prices; usage ESTIMATED)

| Item | 10k DAU | 100k DAU | 1M DAU |
| --- | --- | --- | --- |
| Workers Paid base | $5 | $5 | $5 |
| Worker requests (25/DAU × 30) | 7.5M → within 10M included: $0 | 75M → (75−10)M × $0.30 ≈ $20 | 750M → ≈ $222 |
| Worker CPU (assume ~2 ms avg) | within 30M ms | 150M ms → ≈ $2.4 | 1.5B ms → ≈ $29 |
| Durable Objects requests (≈22/DAU) | 6.6M → ≈ $0.8 | 66M → ≈ $9.8 | 660M → ≈ $99 (+ duration, sharding) |
| KV (weather cells; Cache API absorbs most reads) | ≈ $0 | ≈ $0–20 (writes $5/M beyond 1M) | ≈ $20–100 |
| D1 | $0 | $0 | ≈ $0–5 |
| Routing compute (Valhalla) | Containers standard-1 ≈ $53 (ESTIMATED, always-on behaviour REQUIRES VERIFICATION) | 2 × standard-2 ≈ $185 | external cluster, PROVIDER-DEPENDENT |
| Geocoding (self-hosted Photon) | shares routing host or ≈ $50 | ≈ $100 | PROVIDER-DEPENDENT |
| Open-Meteo plan | Standard–Professional, PROVIDER-DEPENDENT | Professional, PROVIDER-DEPENDENT | Enterprise or self-host, PROVIDER-DEPENDENT |
| Map tiles | OpenFreeMap (free) — consider sponsoring | self-host PMTiles: R2 storage ≈ $0; **serving cost depends on method** (Worker requests vs R2 Class B $0.36/M) — REQUIRES DESIGN | 6B tile requests/month ⇒ ~$1.8–2.2k via Worker/R2 list prices → CDN-cached static tiles needed |

## 5. Cost-control rules (implemented ✓ / planned ○)
- ✓ Batch up to 50 locations per weather request; snap to 0.02° grid; dedupe.
- ✓ Client TTL cache (20 min), stale fallback, refresh only on age or new model run.
- ✓ Driving re-matches cached forecasts; no per-GPS-fix requests.
- ✓ One Overpass queue with endpoint fallback; soft deadlines.
- ✓ OSRM ≤1 req/s per server queue; Nominatim ≤1 req/s.
- ○ Edge cache keyed by cell + model run; request coalescing (one upstream
  fetch per cell in flight — a Durable Object per region or KV lock).
- ○ ≤10 Open-Meteo variables per call.
- ○ Reports corridor request; regional DO shards.
- ○ Weather layer from fixed-grid cells (cacheable across users).
- ○ Alerts on spend: Cloudflare usage notifications; provider dashboards.

## 6. Triggers
| Trigger | Action |
| --- | --- |
| >~25 DAU sustained, or any commercial feature | Open-Meteo paid plan + `/api/v1/weather/points` edge cache |
| >50k Worker requests/day sustained | Workers Paid |
| Public beta | self-hosted Valhalla + Photon + OSM extract; WAF; logs; legal pages |
| Reports DO > 200 req/s peak | shard by region |
| International launch | planet routing on external compute; Enterprise/self-hosted weather; tile hosting plan |
