# Licensing and terms matrix

> **Update 2026-10-04 ([ADR-015](../architecture/decisions/ADR-015-free-software-own-hosting.md),
> [ADR-016](../architecture/decisions/ADR-016-all-on-cloudflare-workers.md)):** production moves to self-hosted free software
> and open data on owner-paid hosting — Cloudflare Workers, R2, D1, Durable Objects, Queues, Containers. Every
> third-party component must be free forever (no limited free tiers, keys with quotas or public demo servers). The
> licences of the new engines and data sources (Valhalla, Photon, Open-Meteo, MOTIS, Planetiler, Overture Places,
> Foursquare OS Places, Open Charge Map, Copernicus, Mangrove, Panoramax, LibreWXR, Kokoro and others) are listed in
> [FREE_STACK_PLAN §10](../FREE_STACK_PLAN.md#10-лицензии-и-обязательства); rows are added here as each component is
> adopted (task DP-6.9).

> Engineering summary of public terms, **not legal advice**. The app is free and non-commercial forever (ADR-015);
> "commercial use" columns are kept for completeness. Rows describe the services the current code uses (until
> DEVELOPMENT_PLAN stage 6) and the open data planned for the pipelines. All rows verified against the linked official
> pages on **2026-10-02** unless marked **REQUIRES VERIFICATION**. Re-verify before any commercial launch and at
> least every 6 months (terms change without notice — e.g. OpenFreeMap's ToS
> says changes are announced on social media and continued use is acceptance).

**Verdicts:** **SAFE** (fits current and intended use with the listed
conditions) · **REQUIRES REVIEW** (usable now, conditions or ambiguity need a
decision/lawyer) · **NOT SUITABLE** (for production/commercial use as currently used).

## Services and data

| Provider | Used for | Licence / terms | Commercial use | Attribution | Limits | Caching / redistribution | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **OpenStreetMap data** ([copyright](https://www.openstreetmap.org/copyright), [attribution guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)) | everything map/route/place | ODbL 1.0 | yes | "© OpenStreetMap contributors", map corner, may collapse behind "(i)" if findable | — | derivative databases must stay ODbL | **SAFE** |
| **OpenFreeMap** ([site](https://openfreemap.org/), [ToS](https://openfreemap.org/tos/)) | vector tiles, styles | free public instance; ToS "AS-IS", Hungarian law | "Yes" (site FAQ); ToS silent | "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" (OpenFreeMap part optional) | "no limits on the number of map views or requests"; no SLA | no automated data collection without permission; self-host via weekly planet builds | **SAFE** (availability risk → ADR-006 fallback) |
| **OpenMapTiles schema/style** ([licence](https://github.com/openmaptiles/openmaptiles/blob/master/LICENSE.md)) | tile schema, style design | code BSD-3; design CC-BY 4.0 | yes | "© OpenMapTiles © OpenStreetMap contributors" | — | — | **SAFE** |
| **MapLibre GL JS** ([licence](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt)) | rendering | BSD-3-Clause ("Copyright (c) 2023, MapLibre contributors") | yes | keep licence notice in distributed code (bundled) | — | — | **SAFE** |
| **OSRM demo** ([policy](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server)) | car routing | "reasonable, non-commercial use-cases" | **no** | OSRM credit (shown) | ≤1 req/s (enforced in app since 2026-10-02); no uptime guarantee | — | **NOT SUITABLE** for production → ADR-004 |
| **FOSSGIS OSRM** routing.openstreetmap.de ([about](https://routing.openstreetmap.de/about.html)) | walking, cycling | usage policy: 1 req/s max, no scraping/heavy use, valid UA/Referer | not addressed | attribution **+ link to the map-improvement page** (added 2026-10-02) | 1 req/s | — | **NOT SUITABLE** for production |
| **Nominatim (OSMF)** ([policy](https://operations.osmfoundation.org/policies/nominatim/)) | not used by default since 2026-10-04 (our geocoder); selectable | usage policy | "Applications and services whose primary function is related to geocoding must run their own service" | ODbL attribution | ≤1 req/s; no autocomplete; no systematic queries; must cache | must cache results | **REQUIRES REVIEW** (OK at low volume; self-host for public beta) |
| **Photon (komoot)** ([site](https://photon.komoot.io/)) | fallback only since 2026-10-04: queries our index can't answer (places abroad), naming outside our tiles | informal: "please be fair - extensive usage will be throttled"; no guarantee | not addressed | OSM attribution | throttled, unspecified | — | **REQUIRES REVIEW** (self-host Photon for public beta) |
| **Overpass API public** ([wiki](https://wiki.openstreetmap.org/wiki/Overpass_API)) | places, POIs, speed limits, cameras, crossings; long-trip stop places and border lookups (called from the Worker with an identifying User-Agent, edge-cached) | fair use | "Commercial use should use self-hosted or paid Overpass servers" | OSM attribution | casual <10,000 queries & <1 GB/day; **regular apps ~100 queries / <10 MB per day**; "currently overloaded" | — | **NOT SUITABLE** for production volume |
| **Open-Meteo API** ([terms](https://open-meteo.com/en/terms), [pricing](https://open-meteo.com/en/pricing)) | forecasts only as a fallback since 2026-10-05 (where our forecast isn't there; `VITE_WEATHER_FALLBACK=none` turns it off); elevation and air quality until DP-4.6/4.7 | free tier non-commercial; data CC BY 4.0 | only with a paid plan (subscriptions/ads = commercial) | "Open-Meteo (CC BY 4.0)" (shown) | <10,000 calls/day, 5,000/hour, 600/min; >10 variables or >2 weeks = multiple calls | CC BY 4.0 allows redistribution with attribution; caching not addressed | **SAFE** non-commercial / **REQUIRES REVIEW** before commercial (plan prices REQUIRE VERIFICATION) |
| **ECMWF open data — IFS 0.25°** ([licence](https://www.ecmwf.int/en/forecasts/datasets/open-data)) — **in use since 2026-10-05** (`npm run data:weather`) | our forecast worldwide: temperature, humidity, clouds, precipitation, snowfall, wind, gusts, CAPE, precipitation type | CC BY 4.0 | yes | "ECMWF IFS (CC BY 4.0) … processed by navWeather" (shown; CC BY asks to say that the data were changed: interpolated to hours, weather code derived) | — (files) | redistribution allowed with attribution | **SAFE** |
| **NOAA GFS 0.25°** ([NOAA data policy](https://www.weather.gov/disclaimer)) — **in use since 2026-10-05** | visibility (fog) in our forecast | US Government work, public domain | yes | credited ("NOAA GFS") | — | allowed | **SAFE** |
| **Open-Meteo open-data archive** on AWS (`s3://openmeteo`, [docs](https://github.com/open-meteo/open-data)) — **in use since 2026-10-05** | where the pipeline reads ECMWF and GFS runs (`.om` files, HTTP range requests, no key) | data CC BY 4.0 (AWS Open Data Sponsorship pays the transfer) | yes | "from the Open-Meteo open-data archive (CC BY 4.0)" (shown) | none stated; ~270 MB per build | allowed with attribution | **SAFE** |
| **Geofabrik extracts** ([download.geofabrik.de](https://download.geofabrik.de/)) — **in use since 2026-10-04** (`npm run data:download`, Georgia) | OSM data for our places tiles (places, cameras, crossings, speed limits) | ODbL (OSM data) | yes | "© OpenStreetMap contributors" (shown in the app) | fair use of downloads (weekly at most) | our tiles are a derivative database → offered under ODbL (stated in `index.json`) | **SAFE** |
| **Natural Earth** ([naturalearthdata.com](https://www.naturalearthdata.com/)) — **in use since 2026-10-04** (1:50m admin-0, `pipelines/borders/build.mjs`; 1:10m populated places in the geocoder) | country borders on the device and in the Worker (Long Trip); world cities in our search | public domain | yes | not required (credited in the data file) | — | redistribution allowed | **SAFE** |
| **Transitous** ([API policy](https://transitous.org/api/), [sources](https://transitous.org/sources/)) | public transport | project must be open source, not commercial, light on resources | **"Commercial use is not allowed"** | visible link to transitous.org/sources (shown) + source licences (e.g. Georgian Railway feed ODbL) | contact them before routing / heavy use | — | **REQUIRES REVIEW** (repo private, no licence; contact pending) |
| **Google voices (Chrome) / Web Speech** ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)) | TTS, push-to-talk | browser features | n/a | — | — | text/audio may be processed by the vendor's service | **REQUIRES REVIEW** (disclosed in Settings; Privacy Policy) |
| **Cloudflare** (Workers, DO, D1, KV, R2, Queues, Containers, Turnstile) ([pricing](https://developers.cloudflare.com/workers/platform/pricing/)) | hosting, API | Cloudflare terms | yes | — | see TARGET_ARCHITECTURE §2 | — | **SAFE** |

## Software dependencies (runtime)

| Package | Licence | Note |
| --- | --- | --- |
| react, react-dom | MIT | — |
| zustand | MIT | — |
| maplibre-gl | BSD-3-Clause | notices kept in bundle |
| Material Icons paths (travel-mode and transit glyphs) | Apache-2.0 | credited in `Icons.tsx` |
| @photostructure/tz-lookup | CC0-1.0 | in the Worker: time zone of a forecast point (`worker/weather.ts`) |

Build-time only (pipelines; never bundled into the app or the Worker):

| Package | Licence | Note |
| --- | --- | --- |
| @openmeteo/file-reader | GPL-2.0 | reads `.om` files in `pipelines/weather/` (dev dependency); its output — our tiles — is data, not a derivative of the program |
| wrangler | MIT OR Apache-2.0 | local Worker, local D1/R2 |

Run `npx license-checker --production` (or equivalent) in CI before a
commercial release — **PLANNED**.

## Engines considered (not used yet)

| Engine | Licence | Note |
| --- | --- | --- |
| Valhalla | MIT | **in use since 2026-10-04**: our router (`ghcr.io/valhalla/valhalla-scripted` image, Georgia graph from OSM) |
| GraphHopper | Apache-2.0 | alternative; hosted API free plan "for non-commercial use only", paid from €69/month |
| OSRM | BSD-2-Clause | current integration |
| MOTIS ([repo](https://github.com/motis-project/motis)) | MIT (verified 2026-10-04) | Transitous' engine: GTFS/NeTEx, GTFS-RT/SIRI, GBFS, OSM streets; self-hosting planned (DP-5.3, Cloudflare Containers) |

## Attribution as shipped
- Map (top-right control): OpenFreeMap © OpenMapTiles Data from OpenStreetMap.
- Sheets (`ui.attribution`): Weather: ECMWF IFS (CC BY 4.0) and NOAA GFS forecasts from the Open-Meteo open-data
  archive (CC BY 4.0), processed by navWeather; where ours is missing, Open-Meteo · Routing: Valhalla on OpenStreetMap
  data; outside our region OSRM (cars: project-osrm.org; walking, cycling: FOSSGIS servers) · Search: our index of
  OpenStreetMap data; elsewhere Photon · Public transport: Transitous · Map data © OpenStreetMap contributors ·
  "Report a map error" → openstreetmap.org/fixthemap.
- Transit trips: "Timetables: Transitous and its sources" → transitous.org/sources/.
