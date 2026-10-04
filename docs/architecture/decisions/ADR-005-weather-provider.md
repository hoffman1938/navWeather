# ADR-005 — Weather: Open-Meteo; shared edge cache + commercial key before commercial use

**Status:** Accepted · **Date:** 2026-10-02 · Facts verified 2026-10-02

## Context
Forecasts, elevation and air quality come from Open-Meteo, called directly by
the browser: up to 50 locations per request, 14 hourly variables, snapped to a
0.02° grid, deduplicated, cached 20 min, refreshed on new model runs. One
Tbilisi → Batumi plan samples ~25 points per road (≈60–85 locations with
alternatives and refinement).

Open-Meteo terms: free tier is **non-commercial** ("websites or apps that have
subscriptions or display advertisements" are commercial), "Less than 10'000 API
calls per day, 5'000 per hour and 600 per minute", data CC BY 4.0.
Pricing: API Standard 1M calls/month, Professional 5M, Enterprise >50M
(prices not shown on the page); "Requests for data covering more than 10
weather variables or extending over a period of more than 2 weeks for a single
location are considered multiple API calls" — fractional (15 variables = 1.5).

## Options

| Provider | Free tier (verified) | Commercial | Route-weather fit |
| --- | --- | --- | --- |
| **Open-Meteo** | <10k calls/day, non-commercial, CC BY 4.0 | paid plans (1M / 5M / >50M per month) | excellent: hourly, many locations per call, model-run metadata, elevation, AQ |
| **MET Norway** (api.met.no) | free, CC BY 4.0, ≤20 req/s per application total, must honour `Expires`/`If-Modified-Since`, ≤4 decimals, identifying User-Agent | allowed, no SLA | good global forecast; one location per request; strict caching rules suit an edge cache |
| WeatherAPI.com | 100k calls/month, 3-day forecast, commercial allowed with attribution | $7–65/month | 3 days is short for "when to leave" |
| OpenWeather | free 60/min, 1M/month; One Call 3.0: first 1,000 calls/day free then 0.0012 GBP | yes | per-location calls; alerts in One Call 4.0 |
| Tomorrow.io | pricing page unavailable (404) — **REQUIRES VERIFICATION** | paid | has road-risk products (paid) |
| Meteomatics | enterprise, pricing on request | paid | rich parameters; cost unknown |

## Decision
1. **MVP (owner + a few testers):** keep Open-Meteo free, called from the
   client, non-commercial. Credit "Open-Meteo (CC BY 4.0)".
   One active user makes ≈350 weighted calls/day (COST_AND_SCALE §1), so the
   **app as a whole** passes the free tier's "<10,000 API calls per day" at
   roughly **30 daily users** — earlier than commercial launch. Whether the
   free tier is meant per end user or per application **REQUIRES REVIEW with
   Open-Meteo**; until confirmed, treat it as per application.
2. **Before a private beta beyond ~25 daily users, and before any commercial use:**
   route forecasts through the Worker — `POST /api/v1/weather/points` —
   with a **shared edge cache keyed by grid cell + forecast model run**, and a
   paid Open-Meteo key held as a Worker secret. Client keeps its own cache.
3. **Fallback provider:** MET Norway behind the same interface for outages
   (its caching rules are natural for an edge cache).
4. **Official warnings:** a separate `WarningsProvider` per region, labelled
   "official", only from sources whose licence allows display (national
   services, MeteoAlarm) — **REQUIRES VERIFICATION per country**.
5. Trim requests to ≤10 variables (REQ-WX-007): drop `relative_humidity_2m`
   (unused) and fold `rain`+`showers`; keep `wind_direction_10m` for future
   crosswind alerts.

## Reason
- Route weather needs hourly forecasts at many points at the ETA; Open-Meteo's
  multi-location requests and model-run metadata fit best and are free now.
- Client-direct calls scale linearly with users; an edge cache makes upstream
  calls scale with **geography × refresh rate** (a corridor like E60 is shared
  by everyone driving it). See COST_AND_SCALE §2.
- A key must never ship in the client (REQ-SEC-001), so commercial use implies
  the Worker proxy.

## Consequences
- Proxying puts every user's calls behind one client (the Worker). The free
  allowance (<10,000 calls/day) would then be shared by all users instead of
  applying per client — exhausted at a few dozen active users (how the free
  limit is enforced, per IP is assumed, **REQUIRES VERIFICATION**). So the
  proxy and the paid key go live **together**.
- The Cache API is per data centre and doesn't support stale-while-revalidate
  with `cache.put/match`; use KV (global, eventually consistent, ≥30 s
  cacheTtl, 1 write/s per key) for hot cells, Cache API in front of it.
- The proxy sees grid cells, not trips: cells are cached without any user id.

## Alternatives rejected
- **Proxy now on the free tier:** one shared allowance for everyone; no
  benefit before scale or commercial use.
- **Switch provider now:** no requirement unmet by Open-Meteo.
