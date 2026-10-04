# Аудит и очистка документации — 2026-10-04

> **Ветка:** `claude/free-stack-plan` · **Основание:** решения владельца 2026-10-04 —
> [ADR-015](../architecture/decisions/ADR-015-free-software-own-hosting.md) (всё стороннее бесплатно всегда, платится только
> хостинг) и [ADR-016](../architecture/decisions/ADR-016-all-on-cloudflare-workers.md) (весь хостинг на Cloudflare Workers,
> всё работает и на localhost) · **План работ:** [DEVELOPMENT_PLAN](../DEVELOPMENT_PLAN.md).
>
> Задача владельца: «удалить всё устаревшее и оставить только актуальное». В документах оставлено только действующее;
> история изменений — в git.

## 1. Как проверялось

| Проверка | Результат |
| --- | --- |
| Перечень документов | 45 файлов `*.md` (≈ 6 800 строк) + 17 файлов `* 2.*` (до очистки) |
| Относительные ссылки | до очистки — 215, битых 0; после — проверены все ссылки остающихся документов, битых 0 |
| Дубликаты | 17 (16 побайтно совпадают с оригиналами, 1 — устаревшая копия COST_AND_SCALE) |
| Сверка с кодом | `wrangler.toml`, `src/config.ts`, `src/services/providers.ts`, `worker/index.ts`, `worker/trips.ts`, `.env.example` |

## 2. Что было не так (кратко)

- Решения менялись трижды за три дня (02.10 → 03.10 → 04.10); большинство документов описывали платные шаги или
  «только бесплатные тарифы» — и то и другое отменено.
- Одновременно существовали четыре плана работ и три аудита.
- Прямые противоречия обязательным требованиям: монетизация в UX_AND_GROWTH, платный ключ погоды и MET Norway (ADR-005,
  TARGET_ARCHITECTURE), публичные сервисы «пока можно» (ADR-004, ADR-011), офлайн-регионы «невозможны» (ADR-012 —
  остаётся «на пересмотре» до ADR-018), README «только бесплатные тарифы, $0».

## 3. Что сделано

**Переписано под действующие решения (устаревшее удалено из текста):**
- `docs/PROJECT_REQUIREMENTS.md` (v2.0): удалены отменённые требования (REQ-COST-001/003/005/007/008, REQ-CF-004/005/006,
  REQ-ROUTE-002/006, REQ-WX-005/007/011/012, REQ-DATA-005, REQ-MAP-005, REQ-SCALE-003); статусы без цепочек «изменено
  ADR-014 → ADR-015»; ссылки на задачи — только `DP-x.y`; добавлены REQ-ROUTE-007, REQ-WX-013, REQ-TEST-007.
- `docs/architecture/TARGET_ARCHITECTURE.md`, `docs/operations/COST_AND_SCALE.md` — заново, под Cloudflare.
- ADR-003, 004, 006, 007, 011, 013 — текущие решения (Valhalla и MOTIS в Containers, свои PMTiles, D1/R2, планировщик на
  Workers Paid); ADR-015 — без ссылок на отменённые ADR; индекс ADR — только действующие.
- `docs/DEVELOPMENT_PLAN.md` — убрана колонка соответствия старым планам; добавлены задачи, которые были только в
  удаляемом плане (DP-11.10…11.13), и задача удаления файлов DP-0.8.
- `docs/FREE_STACK_PLAN.md`, `docs/api/API_V1.md` (новые эндпоинты вместо платного `/weather/points`),
  `docs/ARCHITECTURE.md` (вступление, объединены два раздела «Location», без Pages), `docs/operations/DELIVERY.md`,
  `docs/product/UX_AND_GROWTH.md` (раздел «Монетизация» заменён на «Некоммерческий проект»), `docs/architecture/MAPS_ROUTING_GEO.md`,
  `docs/legal/LICENSING_MATRIX.md` (удалены строки MET Norway, VersaTiles, FOSSGIS routed-car, WeatherAPI, OpenWeather,
  Tomorrow.io, Meteomatics), `docs/security/SECURITY.md`, `docs/mobile/MOBILE_STRATEGY.md` (структура репозитория
  перенесена сюда из удаляемого ROADMAP), `docs/database/DATA_MODEL.md`, `docs/features/LONG_TRIP_MODE.md`,
  `docs/TESTING.md`, `README.md`, `AGENTS.md` (карта документов — только актуальные), комментарии в `.env.example` и
  `wrangler.toml`.

**Создано:** [AUDIT/DEFECTS.md](DEFECTS.md) — реестр дефектов B-01…B-23 с задачами, которые их закрывают (действующая
часть удаляемого MASTER_AUDIT).

## 4. Актуальный набор документов

| Документ | О чём |
| --- | --- |
| `README.md`, `AGENTS.md`, `CLAUDE.md` | вход в проект, правила работы |
| `docs/PROJECT_REQUIREMENTS.md` | требования (единый источник) |
| `docs/DEVELOPMENT_PLAN.md` | единый план работ |
| `docs/FREE_STACK_PLAN.md` | каталог бесплатных замен, функций Google Maps, размещение на Cloudflare |
| `docs/AUDIT/DEFECTS.md` · этот документ | дефекты · аудит и очистка документации |
| `docs/ARCHITECTURE.md` · `docs/ENVIRONMENT.md` · `docs/TESTING.md` | текущий код, переменные, тесты |
| `docs/architecture/TARGET_ARCHITECTURE.md`, `WEATHER_ENGINE.md`, `MAPS_ROUTING_GEO.md` | целевая архитектура, погодный движок, карты и маршруты |
| `docs/architecture/decisions/` | ADR-001…004, 006…013, 015, 016 |
| `docs/api/API_V1.md` · `docs/database/DATA_MODEL.md` | API, данные |
| `docs/legal/LICENSING_MATRIX.md`, `PRIVACY.md` · `docs/security/SECURITY.md` | лицензии, приватность, безопасность |
| `docs/mobile/MOBILE_STRATEGY.md` · `docs/product/UX_AND_GROWTH.md` | мобильная стратегия, UX |
| `docs/operations/COST_AND_SCALE.md`, `DELIVERY.md` | стоимость хостинга, окружения, CI/CD, DR |
| `docs/features/LONG_TRIP_MODE.md` | спецификация Long Trip |

## 5. Удалённые файлы (задача DP-0.8 — выполнено 2026-10-04)

Удалены из репозитория (история — в git); после удаления: 39 документов, 188 относительных ссылок, битых 0:

- 17 дубликатов `* 2.*`: 9 в `docs/` (`architecture/MAPS_ROUTING_GEO 2.md`, `architecture/TARGET_ARCHITECTURE 2.md`,
  `architecture/WEATHER_ENGINE 2.md`, `features/LONG_TRIP_MODE 2.md`, `mobile/MOBILE_STRATEGY 2.md`,
  `operations/COST_AND_SCALE 2.md`, `operations/DELIVERY 2.md`, `product/UX_AND_GROWTH 2.md`, `security/SECURITY 2.md`)
  и 8 в `src/` (`api/v1 2.ts`, `api/v1.test 2.ts`, `components/Plan/Transit 2.css`, `components/Plan/TransitTrip 2.tsx`,
  `components/Trip/LongTrip 2.tsx`, `components/Trip/LongTripDetails 2.tsx`, `components/Trip/Trip 2.css`,
  `services/routing/TransitousProvider.test 2.ts`);
- заменённые планы: `docs/PRODUCTION_READINESS_PLAN.md`, `docs/ROADMAP.md`, `docs/AUDIT/IMPLEMENTATION_ROADMAP.md`;
- исторические аудиты и журналы: `docs/AUDIT.md`, `docs/PLAN.md`, `docs/AUDIT/2026-10-02-platform-audit.md`,
  `docs/AUDIT/FEATURE_GAP_ANALYSIS.md`, `docs/AUDIT/MASTER_AUDIT.md` (дефекты перенесены в `DEFECTS.md`);
- отменённые решения: `docs/architecture/decisions/ADR-005-weather-provider.md`, `docs/architecture/decisions/ADR-014-zero-cost.md`.

## 6. Что ещё остаётся

- Прогнать `npm test` и `npm run build` (на этой машине нет Node.js — проверить в CI или локально); дубликаты
  исходников были побайтными копиями и нигде не импортировались.
- ADR-012 (офлайн) остаётся «на пересмотре» до ADR-018 (DP-9.8); ENVIRONMENT, DELIVERY, PRIVACY, SECURITY,
  MAPS_ROUTING_GEO и LONG_TRIP_MODE описывают текущий код с пометкой о целевом состоянии — обновляются вместе со своими
  задачами (этапы 2–6).
