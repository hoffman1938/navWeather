# MASTER AUDIT — navWeather (Navigation + Weather + Long Trip)

> **Дата:** 2026-10-03 · **Ветка:** `claude/navweather-dev` · **Коммит:** `46ac9fa`
> **Роли:** архитектор, продакт, UX/UI, QA, безопасность, Cloudflare, mobile.
> **Принцип:** документация показывает, что *должно* быть; код и прогоны показывают, что *есть*.
> Статус «✅ VERIFIED» ставится только при автоматическом тесте **или** живой проверке в этом аудите.
> Предыдущий аудит: [2026-10-02-platform-audit.md](2026-10-02-platform-audit.md) (часть его выводов
> подтверждена, часть статусов «VERIFIED» в требованиях — завышена, см. §5).
> Сопутствующие документы: [FEATURE_GAP_ANALYSIS.md](FEATURE_GAP_ANALYSIS.md) ·
> [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md) (заменён).
> **Обновление 2026-10-03:** владелец решил, что приложение полностью бесплатное ([ADR-014](../architecture/decisions/ADR-014-zero-cost.md)).
> Платные варианты в §12 и §20 исключены; путь к production — [PRODUCTION_READINESS_PLAN](../PRODUCTION_READINESS_PLAN.md).
> При планировании найдены дефекты B-22 и B-23 (§4).

---

## 0. Что прочитано и что отсутствует

| Путь из задания | Найдено | Комментарий |
| --- | --- | --- |
| `/docs/PROJECT_REQUIREMENTS.md` | ✔ | v1.0 от 2026-10-02, 490 строк; статусы частично завышены (§5) |
| `/docs/features/` | ✔ | только `LONG_TRIP_MODE.md` (275 строк) |
| `/docs/architecture/` | ✔ | `TARGET_ARCHITECTURE.md`, `WEATHER_ENGINE.md`, `MAPS_ROUTING_GEO.md` |
| `/docs/architecture/decisions/` | ✔ | ADR-001…ADR-013 + README |
| `/docs/runbooks/` | **✘ ОТСУТСТВУЕТ** | процедуры отката/DR частично в `docs/operations/DELIVERY.md`; runbook'ов на инциденты, отказ провайдеров, ротацию ключей нет |
| `/docs/` (прочее) | ✔ | ARCHITECTURE, AUDIT (история), ENVIRONMENT, PLAN (рус.), ROADMAP, TESTING, api/, database/, legal/, mobile/, operations/, product/, security/ |
| `/plan.md` | **✘ в корне нет** | существует `docs/PLAN.md` (журнал итераций на русском) |
| `README.md`, `AGENTS.md`, `CLAUDE.md` | ✔ | `CLAUDE.md` = `@AGENTS.md` |
| `package.json`, `package-lock.json` | ✔ | 4 runtime-зависимости (react, react-dom, zustand, maplibre-gl) |
| Cloudflare / Wrangler | ✔ | `wrangler.toml`: Worker + assets, 2 DO (SQLite), 4 rate-limit binding'а, `observability.enabled=false` |
| Environment | ✔ | `.env.example`, `docs/ENVIRONMENT.md`, `src/config.ts` |
| БД | ✔ | серверной БД нет (по решению ADR-007); SQLite внутри DO `Reports`; `database/migrations/0001_accounts.sql` — PROPOSED, не применена |
| Аутентификация | — | отсутствует по решению (anonymous-first, ADR-008) |
| Уведомления | **✘** | нет Notification/Push API; только голос + баннер на переднем плане |
| Mobile-код | **✘** | нативных приложений нет; движки готовы к переносу |
| CI/CD | ✔ | `ci.yml`, `deploy.yml` (ручной), `dependabot.yml`; факт запусков проверить нельзя (нет `gh`) |
| `/docs/AUDIT/` | создан | каталог `docs/audit/` переименован в `docs/AUDIT/` (ссылки обновлены) |

## 1. Как проводилась проверка (доказательства)

| # | Проверка | Результат |
| --- | --- | --- |
| E1 | `npx vitest run` | **65 файлов / 586 тестов — пройдено**, 1 файл (live) пропущен по умолчанию |
| E2 | `npm run typecheck` (app + Worker) | без ошибок |
| E3 | `npm run build` | успешно; `index` **604.6 KB (196.3 KB gzip)**, `maplibre` 1,030 KB (281 KB gzip, ленивый), `RouteMap` 30 KB, `ru` 50 KB, `LongTripDetails` 7 KB, `SettingsDialog` 10 KB |
| E4 | `wrangler dev` + smoke (`test:share`, `test:reports`, `test:trips`) | **7/7, 5/5, 4/4**; `/api/v1/health` = `{"ok":true,"api":1}`; план 1,200 км за 116 мс |
| E5 | Живой прогон в браузере (dev-сборка, **реальные публичные провайдеры**) Tbilisi → Batumi | маршрут 357 км / 4 ч 53 мин, 2 дороги, прогноз на ETA каждой точки, совет «выезжать в 04:00»; сеть: Nominatim ×2, Photon ×1 + 8 reverse, OSRM ×5 (1 маршрут + 4 via-пробы, строго последовательно), Open-Meteo elevation ×1, meta ×3, forecast ×2 (батч); **Overpass: overpass-api.de → 504 за 8 с, kumi.systems → обрыв за 12 с** (названия посёлков пришли позже/из Photon) |
| E6 | Живой Long Trip Tbilisi → Istanbul (выезд 00:23) | 1,615 км / 19 ч 36 мин вождения → LONG, 2 ночёвки, 8 перерывов, **1 приём пищи за 41 ч**, 9 погодных рисков, граница Грузия → Турция ~383 км; отели первой ночи из OSM (Giresun, 5 шт., «доступность не проверяется»); **ночёвка №1 в 09:22–18:22 (днём), ночёвка №2 в 22:00 того же дня**; у остановок нет названий городов до ручного «Повторить» |
| E7 | Живой Tbilisi → Berlin | 3,809 км / 41.8 ч, 5 ночёвок, прибытие через 4.5 дня; **77 из 145 точек без прогноза** после первой загрузки (прогноз запрошен на 48 ч); после повторной загрузки 0/145, но **риски Long Trip не пересчитаны** (8 рисков, все в день 1) |
| E8 | Живая симуляция Tbilisi → Batumi (60×) | голос: «Heavy rain is expected in about 35 minutes, near Lanchkhuti.», баннер high — **цепочка «маршрут + ETA + прогноз → предупреждение» работает**; события камер дублируются (+43 мин ×2) |
| E9 | Временные проверочные тесты (созданы и удалены) | (a) задержка внутри **запланированной** 45-мин стоянки = **1,500 с** → срабатывает перепланирование; (b) `hazardCode`: порывы 65 км/ч → 0 (алерты: сильный ветер), дождь при 0.8 °C → «дождь» (алерты: гололёд), мокрый снег при 2 °C → «снег» (алерты: гололёд); (c) запас хода 500 км: заправка на 338 км; перепланирование на 300 км (+30 мин) → **заправка на 660 км** |
| E10 | `npm audit` | prod: **0**; dev: 3 (1 high — `undici` через `wrangler 4.142`/`miniflare`) |
| E11 | Быстрый a11y-скан DOM | 40 интерактивных элементов, **0 без доступного имени**, есть `prefers-reduced-motion`, `lang` задан; <24 px: маркеры погоды на карте, ссылки атрибуции |
| E12 | Поиск по коду | TODO/FIXME/HACK — 0; `any` — 0; `console.*` — 2 (оба оправданы); 8 `eslint-disable` при **отсутствующем ESLint** |

## 2. Легенда

**Статусы (только эти):** ✅ VERIFIED (тест или живая проверка) · 🟢 IMPLEMENTED (код есть, полной проверки нет) ·
🟡 PARTIALLY IMPLEMENTED · 🔴 NOT IMPLEMENTED · ⚠️ BROKEN (есть, но работает неверно — подтверждено) ·
❓ UNKNOWN / NEEDS VERIFICATION.
**Приоритеты:** P0 — без исправления приложение нельзя считать рабочим · P1 — высокий · P2 — средний · P3 — низкий.
Приоритет в таблице — важность требования / оставшейся работы. «B-xx» — ссылки на подтверждённые дефекты в §4.

---

## 3. MASTER TABLE

### 3.1 Ядро: навигация + маршрут + ETA + погода + предупреждения

| ID | Требование | Статус | Реализация | Баги | Что отсутствует | Приоритет | Файл |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CORE-01 | Открытие приложения (PWA-оболочка, карта грузится лениво) | ✅ VERIFIED | Vite SPA; MapLibre в отдельном чанке; SW-оболочка (E3, E5, `serviceWorker.test.ts`) | — | — | P0 | `src/main.tsx`, `src/App.tsx`, `public/sw.js` |
| CORE-02 | Точка отправления: поиск, автодополнение, «Моё местоположение», приблизительное место | ✅ VERIFIED | Nominatim (≤1 req/s) + Photon; GPS → `/api/v1/whereami` (E5, `location.test.ts`) | — | — | P0 | `src/components/Search/*`, `src/services/location.ts` |
| CORE-03 | Назначение: поиск, пин на карте, ссылка `?p=` | ✅ VERIFIED | `explore.ts`, `links.ts` (тесты, E5) | — | — | P0 | `src/state/explore.ts`, `src/share/links.ts` |
| CORE-04 | Расчёт маршрута по реальной геометрии дорог | ✅ VERIFIED | OSRM `overview=full`, шаги, полосы (E5, `OSRMProvider.test.ts`) | — | собственный роутер (RT-10) | P0 | `src/services/routing/OSRMProvider.ts` |
| CORE-05 | Отображение маршрута и альтернатив | ✅ VERIFIED | слои MapLibre (E5) | — | — | P0 | `src/components/Map/RouteMap.tsx`, `mapLayers.ts` |
| CORE-06 | ETA для каждой вершины маршрута (не «расстояние / константа») | ✅ VERIFIED | per-edge `annotations` OSRM, масштабированные к длительности leg; fallback шаги → пропорционально; хук `currentDurationS` для трафика | — | живой трафик (нет источника) | P0 | `src/algorithms/routeTiming.ts` |
| CORE-07 | Погода вдоль маршрута (поездки до ~46 ч) | ✅ VERIFIED | адаптивные точки → сетка 0.02° → батч ≤50 → TTL → stale (E5, тесты) | — | многодневные поездки — см. WX-08 | P0 | `src/services/routePlanner.ts`, `src/services/weather/WeatherService.ts` |
| CORE-08 | Прогноз на время прибытия в каждую точку, в её часовом поясе | ✅ VERIFIED | интервальные значения — час, содержащий ETA; мгновенные — интерполяция; без экстраполяции | — | — | P0 | `src/algorithms/weatherMatching.ts`, `src/utils/timezone.ts` |
| CORE-09 | Обнаружение погодных рисков | 🟢 IMPLEMENTED | латчинг с гистерезисом, мосты через сухие промежутки | B-08 | единые пороги (RISK-06) | P0 | `src/intelligence/weatherAlerts.ts` |
| CORE-10 | Создание предупреждений (голос + баннер) | ✅ VERIFIED | `DriverAlertEngine` (E8, тесты) | — | фоновые уведомления (AL-05) | P0 | `src/intelligence/driverAlerts.ts`, `src/state/store.ts` (`onProgress`) |
| CORE-11 | Навигация: повороты, полосы, голос, камера | 🟢 IMPLEMENTED | манёвры, инструкции, подсказки по скорости; симуляция | B-10 | проверка на реальном телефоне в машине | P0 | `src/navigation/*`, `src/state/store.ts` |
| CORE-12 | Пересчёт при уходе с маршрута | ✅ VERIFIED | гистерезис отклонения, переход на известную дорогу без сети, `recalculateFrom` (`scenarios.test.ts`, `roads.test.ts`) | — | без сети пересчёта нет (ожидаемо) | P0 | `src/algorithms/routeDeviation.ts`, `roadMatching.ts`, `store.ts` |
| CORE-13 | Пересчёт при изменении условий (новый прогноз, новый прогон модели, погодный объезд) | 🟢 IMPLEMENTED | `refreshIfStale`, проверка `meta.json`, `maybeOfferWeatherReroute` | B-07 (Long Trip) | трафик | P1 | `src/state/store.ts` |
| FEAT-01 | Лучшее время выезда (12 ч вперёд) | ✅ VERIFIED | E5 «Leave at 04:00: about 1 h 33 min less heavy weather»; тесты | — | — | P1 | `src/algorithms/departurePlanner.ts` |
| FEAT-02 | Карточка места: погода сейчас / при прибытии / 7 дней | ✅ VERIFIED | `explore.test.ts` | — | — | P1 | `src/state/explore.ts`, `src/components/Explore/PlaceSheet.tsx` |
| FEAT-03 | Live-шаринг местоположения (только последняя точка, срок жизни) | ✅ VERIFIED | E4 7/7 | — | — | P2 | `worker/liveShare.ts`, `src/share/*` |
| FEAT-04 | Сообщения водителей (всегда «сообщено», не факт) | ✅ VERIFIED | E4 5/5 | веерная выборка ≤24 запросов на обновление | запрос «коридором» | P2 | `worker/reports.ts`, `src/services/traffic/ReportsIncidentProvider.ts` |
| FEAT-05 | Предложение объезда из-за погоды (никогда не автоматически) | 🟢 IMPLEMENTED | `weatherReroute.test.ts` | — | — | P2 | `src/algorithms/weatherReroute.ts`, `store.ts` |
| FEAT-06 | Напоминание о заправке / зарядке из заявленного запаса (обычный режим) | ⚠️ BROKEN | точка на 70 % запаса; только данные пользователя | B-02 | учёт пройденного расстояния | P0 | `src/intelligence/routeIntelligence.ts` |

### 3.2 Карта

| ID | Требование | Статус | Реализация | Баги | Что отсутствует | Приоритет | Файл |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MAP-01 | MapLibre + OpenFreeMap, светлый/тёмный стиль | ✅ VERIFIED | E5; `useEffectiveTheme.test.ts` | — | — | P0 | `RouteMap.tsx`, `src/services/map/MapProvider.ts` |
| MAP-02 | Атрибуция OSM / OpenMapTiles / OpenFreeMap и источников данных | 🟢 IMPLEMENTED | `AttributionControl` на карте + строка в листе + «Report a map error» | B-13 | Overpass явно не назван | P0 | `src/components/Common/Attribution.tsx`, `src/i18n/en.ts:470` |
| MAP-03 | Маркеры погоды, обновление маршрута, разгрузка подписей | ✅ VERIFIED | стабильный `displayPoints` (тесты, E5) | B-15 | — | P1 | `src/components/WeatherMarker/*`, `mapLayers.ts` |
| MAP-04 | GPS-точка, точность, «найти меня», следование | 🟢 IMPLEMENTED | `LocationWatcher`, кнопка, круг точности (тесты на логику) | — | реальные устройства | P0 | `src/services/location.ts`, `src/components/Map/LocateButton.tsx` |
| MAP-05 | Состояния загрузки/ошибки карты, отсутствующие тайлы | 🟡 PARTIALLY IMPLEMENTED | плейсхолдер, `ErrorBoundary`, «карта недоступна» до загрузки стиля | ошибки тайлов после загрузки — только `console.warn` | индикатор отсутствующих тайлов/офлайна | P2 | `RouteMap.tsx:131` |
| MAP-06 | Офлайн-карта (тайлы) | 🔴 NOT IMPLEMENTED | сознательно нет на web (ADR-012) | — | регионы PMTiles (native) | P3 | `docs/architecture/decisions/ADR-012-offline.md` |
| MAP-07 | Слой трафика | 🔴 NOT IMPLEMENTED | нет бесплатного источника; интерфейс есть | — | провайдер трафика | P3 | `src/services/traffic/TrafficProvider.ts` |
| MAP-08 | Погодный слой (прогноз осадков/температуры, не радар) | 🟢 IMPLEMENTED | сетка 7×7 (49 точек одним запросом), слайдер часов | — | радар (нет источника) | P2 | `src/components/Map/useWeatherLayer.ts`, `src/algorithms/weatherGrid.ts` |
| MAP-09 | Резервный самохостинг тайлов (PMTiles на R2) | 🔴 NOT IMPLEMENTED | PLANNED | — | всё | P2 | ADR-006 |
| MAP-10 | Производительность карты на мобильных (FPS, память) | ❓ UNKNOWN / NEEDS VERIFICATION | вёрстка 375 px корректна (E5) | — | замер на реальном телефоне | P1 | — |

### 3.3 Маршрутизация

| ID | Требование | Статус | Реализация | Баги | Что отсутствует | Приоритет | Файл |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RT-01 | Альтернативные маршруты (до 3 действительно разных дорог) | ✅ VERIFIED | `alternatives=3` + via-пробы + фильтр похожих (E5: 1 альтернатива; тесты) | — | — | P1 | `src/algorithms/routeAlternatives.ts`, `src/services/routePlanner.ts` |
| RT-02 | Выбор «кратчайший / быстрейший» | 🔴 NOT IMPLEMENTED | только «быстрейший» + альтернативы | — | профиль shortest (нужен свой роутер) | P3 | `OSRMProvider.ts` |
| RT-03 | Пересчёт при отклонении GPS | ✅ VERIFIED | см. CORE-12 | — | — | P0 | `src/algorithms/routeDeviation.ts` |
| RT-04 | Перекрытия / недоступные дороги | 🔴 NOT IMPLEMENTED | отчёты «перекрыто» только показываются | — | учёт перекрытий роутером | P2 | `src/services/traffic/*` |
| RT-05 | Ошибки маршрута: нет маршрута, сервис занят, офлайн, то же место | 🟢 IMPLEMENTED | `describeError`, «то же место» < 50 м | — | — | P1 | `routePlanner.ts` (`describeError`), `store.ts` (`calculateRoute`) |
| RT-06 | Мультиостановки A→B→C→D | 🟡 PARTIALLY IMPLEMENTED | до 3 промежуточных точек в заданном порядке | — | перестановка/оптимизация; время стоянки на точке | P2 | `store.ts` (`addWaypoint`), `src/components/Search/SearchPanel.tsx` |
| RT-07 | Модель ETA: тип дороги, скорость, трафик, остановки, погода | 🟡 PARTIALLY IMPLEMENTED | типичные скорости OSRM по рёбрам; остановки Long Trip добавляются | — | трафик; влияние погоды на скорость; адаптация к темпу водителя | P1 | `routeTiming.ts`, `src/state/derive.ts` |
| RT-08 | Избегать платных дорог / магистралей / паромов | 🔴 NOT IMPLEMENTED | BLOCKED: публичный OSRM отклоняет `exclude` | — | свой роутер | P2 | `OSRMProvider.ts` (`capabilities.avoid`) |
| RT-09 | Политика публичных OSRM ≤1 запрос/с | ✅ VERIFIED | очередь на сервер (тесты; E5 — запросы последовательны) | — | — | P0 | `OSRMProvider.ts` |
| RT-10 | Собственный роутер до публичной беты | 🔴 NOT IMPLEMENTED | PLANNED (Valhalla, ADR-004) | — | всё | P1 | ADR-004 |
| RT-11 | Режимы: пешком, велосипед, транспорт, самолёт (оценка) | 🟢 IMPLEMENTED | отдельные провайдеры; тесты на фикстурах | — | живая проверка FOSSGIS; условия Transitous (LIC-02) | P1 | `src/services/routing/*`, `src/state/travelModes.test.ts` |

### 3.4 Погода вдоль маршрута

| ID | Требование | Статус | Реализация | Баги | Что отсутствует | Приоритет | Файл |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WX-01 | Адаптивная выборка точек (посёлки, перевалы, развязки, ≤45 мин) | ✅ VERIFIED | приоритеты точек, бюджет по длине | — | — | P0 | `src/algorithms/routeSampling.ts` |
| WX-02 | Батчинг, дедупликация по сетке, кэш, без экстраполяции | ✅ VERIFIED | E5: 2 запроса прогноза на 2 дороги; тесты | — | — | P0 | `WeatherService.ts` |
| WX-03 | Осадки, температура, ветер, порывы, видимость, снег, облачность, влажность | ✅ VERIFIED | 14 часовых переменных | — | — | P0 | `src/services/weather/OpenMeteoProvider.ts` |
| WX-04 | Гололёд / скользкая дорога (производная оценка) | 🟢 IMPLEMENTED | мороз + осадки, `roadSurface`, формулировка «возможно» | B-08 | — | P1 | `weatherAlerts.ts`, `src/algorithms/roadHazards.ts` |
| WX-05 | Грозы / суровая погода | 🟡 PARTIALLY IMPLEMENTED | WMO-код грозы, «град» по описанию, порывы ≥90 → critical | — | молнии / радар / CAPE | P2 | `weatherAlerts.ts` |
| WX-06 | Официальные предупреждения (метеослужбы, MeteoAlarm) | 🔴 NOT IMPLEMENTED | PLANNED | — | источник и лицензия | P2 | ADR-005 |
| WX-07 | Неопределённость прогноза | 🟢 IMPLEMENTED | уверенность по горизонту + вероятности, потолок серьёзности | — | разброс моделей/ансамбли | P2 | `weatherMatching.ts`, `weatherAlerts.ts` |
| WX-08 | Горизонт прогноза покрывает всю поездку вместе с остановками | ⚠️ BROKEN | первая загрузка — 48 ч | B-06 | — | P1 | `store.ts` (`loadWeather`), `WeatherService.ts` (`forecastHoursFor`) |
| WX-09 | Устаревание, новые прогоны модели, офлайн | ✅ VERIFIED | тесты | — | — | P0 | `WeatherService.ts`, `store.ts` (`refreshIfStale`) |
| WX-10 | Общий edge-кэш погоды (Worker + Cache API/KV) | 🔴 NOT IMPLEMENTED | PLANNED | — | всё (лимит free ~30 DAU) | P1 | ADR-005, `docs/operations/COST_AND_SCALE.md` |
| WX-11 | ≤10 переменных в запросе (иначе ×1.4 вызова) | 🔴 NOT IMPLEMENTED | сейчас 14 | — | — | P2 | `OpenMeteoProvider.ts` |
| WX-12 | Боковой ветер | 🔴 NOT IMPLEMENTED | `windDirection` уже запрашивается | — | — | P3 | — |
| WX-13 | Резервный провайдер погоды | 🔴 NOT IMPLEMENTED | MET Norway — кандидат | — | — | P2 | ADR-005 |

### 3.5 Движок погодных рисков

| ID | Требование | Статус | Реализация | Баги | Что отсутствует | Приоритет | Файл |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RISK-01 | Дождь, ливень, снег, гололёд, туман, ветер, гроза, плохая видимость | ✅ VERIFIED | `weatherAlerts.test.ts` | — | — | P0 | `weatherAlerts.ts` |
| RISK-02 | Экстремальная температура (жара / сильный мороз) | 🔴 NOT IMPLEMENTED | есть только «резкое похолодание» | — | — | P2 | `weatherAlerts.ts` |
| RISK-03 | Серьёзность и уверенность | ✅ VERIFIED | `capByConfidence` | — | — | P0 | `weatherAlerts.ts` |
| RISK-04 | Дедупликация, анти-спам | ✅ VERIFIED | латчинг, cooldown, ≤4/ч, эскалация (тесты, E8) | — | — | P0 | `driverAlerts.ts` |
| RISK-05 | Пороги задокументированы и тестируемы | 🟡 PARTIALLY IMPLEMENTED | тесты есть; в `WEATHER_ENGINE.md` указаны только порывы и похолодание | — | полная таблица порогов с обоснованием | P1 | `docs/architecture/WEATHER_ENGINE.md` |
| RISK-06 | Один настраиваемый набор порогов для алертов, рисков поездки, сравнения дорог, времени выезда | ⚠️ BROKEN | пороги захардкожены в 7 файлах и расходятся | B-08, B-09 | модуль конфигурации порогов | P1 | `weatherAlerts.ts`, `src/trip/weather/hazards.ts`, `derive.ts`, `departurePlanner.ts`, `roadHazards.ts`, `WeatherStrip.tsx` |
| RISK-07 | Оценка ложных срабатываний/пропусков (бэктест) | 🔴 NOT IMPLEMENTED | — | — | прогон на архиве прогнозов | P2 | — |

### 3.6 Предупреждения

| ID | Требование | Статус | Реализация | Баги | Что отсутствует | Приоритет | Файл |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AL-01 | Будущее предупреждение: «ливень через 35 мин, около X» | ✅ VERIFIED | E8 | — | — | P0 | `weatherAlerts.ts` |
| AL-02 | Окна по серьёзности, частота, приоритет голоса | ✅ VERIFIED | тесты | — | — | P0 | `driverAlerts.ts`, `src/voice/queue.ts` |
| AL-03 | Пересчёт после смены маршрута / отклонения / обновления прогноза | ✅ VERIFIED | `derive` пересопоставляет; перенос состояния события (тот же тип ≤20 км) | — | — | P0 | `derive.ts`, `driverAlerts.ts` |
| AL-04 | Пересчёт после задержки в пробке | 🟡 PARTIALLY IMPLEMENTED | ETA = сейчас + оставшееся модельное время (задержка учитывается неявно) | — | источник трафика | P2 | `routeTiming.ts` (`computeArrivals`) |
| AL-05 | Уведомления в фоне и разрешения на них | 🔴 NOT IMPLEMENTED | только на переднем плане | — | абстракция уведомлений; native | P2 | — |

### 3.7 Long Trip Mode

| ID | Требование | Статус | Реализация | Баги | Что отсутствует | Приоритет | Файл |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LT-01 | TripClassificationEngine (800 км / 10 ч / ночёвка / ≥3 перерыва), пороги в конфиге | ✅ VERIFIED | E6, тесты (включая ровно 800 км) | — | — | P1 | `src/trip/config.ts`, `src/trip/classification/classify.ts` |
| LT-02 | TripPlanner → TripPlan / TripSegment / TripDay | ✅ VERIFIED | Worker `/api/v1/trips/plan` (E4, E6) | — | — | P1 | `src/trip/planning/planner.ts`, `worker/trips.ts` |
| LT-03 | Логика приложения меняется для длинной поездки | ✅ VERIFIED | баннер, дашборд, таймлайн, остановки заменяют общие напоминания (E6, `trip.test.tsx`) | — | — | P1 | `src/components/Trip/*`, `routeIntelligence.ts` |
| LT-04 | Планирование перерывов | 🟢 IMPLEMENTED | пресеты темпа | B-03 | — | P1 | `src/trip/planning/schedule.ts` |
| LT-05 | Планирование приёмов пищи | ⚠️ BROKEN | окна обеда/ужина | B-04 | — | P1 | `schedule.ts` |
| LT-06 | Ночёвки: время и правдоподобность (в т. ч. ночной выезд) | ⚠️ BROKEN | дневной лимит / позднее прибытие | B-04 | учёт ночного вождения | P1 | `schedule.ts` (`overnightIn`) |
| LT-07 | Ночёвки: выбор города и альтернативы | ⚠️ BROKEN | скоринг городов работает, когда посёлки уже загружены | B-05 | — | P1 | `src/trip/planning/overnight.ts`, `src/state/trip.ts` |
| LT-08 | Планирование топлива (запас, расход, бак, резерв) | ⚠️ BROKEN | только из заявленного пользователем запаса | B-01, B-20 | учёт израсходованного запаса | P0 | `schedule.ts`, `src/state/trip.ts`, `planner.ts` |
| LT-09 | Зарядка EV (батарея, запас, станции, время, доступность, погода) | 🟡 PARTIALLY IMPLEMENTED | 35 мин (оценка), станции ≥50 кВт в приоритете | — | SoC, мощность станции, влияние погоды на запас, доступность | P2 | `config.ts`, `src/trip/stops/recommend.ts` |
| LT-10 | Динамическое перепланирование | ⚠️ BROKEN | при отставании ≥20 мин, cooldown 10 мин | B-01, B-03 | — | P1 | `src/state/trip.ts` (`checkProgress`), `src/trip/replanning/progress.ts` |
| LT-11 | Погода на реальное время с учётом остановок (многодневно) | 🟡 PARTIALLY IMPLEMENTED | длительности остановок добавляются к каждому ETA | B-06, B-07, B-21 | — | P1 | `derive.ts`, `src/trip/weather/risks.ts` |
| LT-12 | Совет «остановиться раньше» из-за погоды | 🟢 IMPLEMENTED | тесты | B-07 (устаревает) | — | P2 | `risks.ts` (`stopEarlierAdvice`) |
| LT-13 | Предпочтения поездки (темп, звёзды, еда, бренд АЗС) | 🟢 IMPLEMENTED | только на устройстве | — | — | P2 | `src/components/Settings/SettingsDialog.tsx` |
| LT-14 | Отели вдоль маршрута из OSM; «Рекомендовано», наличие мест не проверяется | ✅ VERIFIED | E6 (Giresun); `availability: 'not-checked'`; тесты ранжирования | — | — | P1 | `recommend.ts`, `worker/trips.ts` |
| LT-15 | Цена / рейтинг / наличие мест / check-in отеля | 🔴 NOT IMPLEMENTED | BLOCKED (нет открытого источника) — **правильно не подделывается** | — | партнёр бронирования | P3 | — |
| LT-16 | Места отдыха: туалеты, стоянки грузовиков, души, охраняемые парковки | 🟡 PARTIALLY IMPLEMENTED | rest_area / services / hgv-парковки, туалеты | — | души, охраняемые стоянки | P3 | `src/trip/stops/places.ts` |
| LT-17 | АЗС: предпочитаемый бренд, цены | 🟡 PARTIALLY IMPLEMENTED | бренд — да; цены — BLOCKED | — | цены топлива | P3 | `recommend.ts` |
| LT-18 | Юридические нормы вождения/отдыха по юрисдикции | 🔴 NOT IMPLEMENTED | честно указано «не встроено» | — | проверенные правила | P3 | `config.ts` |
| LT-19 | Учёт ночного вождения / усталости | 🔴 NOT IMPLEMENTED | — | B-04 | правило/предупреждение о вождении 00–06 | P2 | `schedule.ts` |

### 3.8 Мультиостановки, ТС, граница, таймлайн

| ID | Требование | Статус | Реализация | Баги | Что отсутствует | Приоритет | Файл |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MS-01 | Маршрут через до 3 промежуточных точек | 🟢 IMPLEMENTED | порядок задаётся пользователем | — | — | P2 | `store.ts` |
| MS-02 | Перестановка / оптимизация порядка точек | 🔴 NOT IMPLEMENTED | — | — | — | P3 | — |
| MS-03 | ETA каждой точки, погода по участкам | 🟡 PARTIALLY IMPLEMENTED | события STOP с ETA; погода по точкам выборки | — | время стоянки на точке (сейчас 0) | P2 | `routeIntelligence.ts` |
| MS-04 | Мультиостановки вместе с Long Trip / пересчётом | 🟡 PARTIALLY IMPLEMENTED | при пересчёте остаются оставшиеся точки | — | пользовательские остановки не влияют на расписание | P3 | `src/state/trip.ts` |
| VH-01 | Типы ТС: легковой / фургон / грузовик / мотоцикл, топливо / EV | 🟡 PARTIALLY IMPLEMENTED | в настройках; влияет только на ранжирование мест | — | влияние на маршрут | P2 | `src/state/settings.ts`, `recommend.ts` |
| VH-02 | Truck: габариты, масса, оси, прицеп, ADR, ограничения, низкие мосты | 🔴 NOT IMPLEMENTED | BLOCKED (ADR-004) — честно отмечено | — | Valhalla truck costing | P3 | — |
| VH-03 | Автобус | 🔴 NOT IMPLEMENTED | — | — | — | P3 | — |
| BD-01 | Пересечения границ вдоль маршрута | ✅ VERIFIED | E6 (Грузия → Турция), тесты, edge-кэш 7 дней | — | — | P2 | `src/trip/borders.ts`, `worker/trips.ts` |
| BD-02 | Время ожидания / часы работы / ограничения на границе | 🔴 NOT IMPLEMENTED | **NOT AVAILABLE** — источника нет, данные не выдумываются | — | — | P3 | — |
| TL-01 | Таймлайн: выезд, топливо, отдых, еда, погода, отель, граница, прибытие | 🟢 IMPLEMENTED | `buildTimeline` + границы | B-04 | — | P1 | `planner.ts` (`buildTimeline`), `src/components/Trip/LongTripDetails.tsx` |
| TL-02 | Согласованный пересчёт таймлайна после изменения ETA | 🟡 PARTIALLY IMPLEMENTED | только при перепланировании за рулём | B-03, B-07 | пересчёт при новом прогнозе в режиме планирования | P1 | `src/state/trip.ts` |

### 3.9 Голосовой ассистент

| ID | Требование | Статус | Реализация | Баги | Что отсутствует | Приоритет | Файл |
| --- | --- | --- | --- | --- | --- | --- | --- |
| VO-01 | Распознавание речи (push-to-talk) | 🟢 IMPLEMENTED | Web Speech API; микрофон end-to-end не проверялся | — | Safari/Firefox без распознавания | P2 | `src/voice/providers.ts` |
| VO-02 | Команды: погода впереди, когда дождь, ETA, следующий поворот, «где я», пересчитать | 🟢 IMPLEMENTED | парсер en/ru (тесты); ответы из того же движка | — | — | P2 | `src/voice/parser.ts`, `src/voice/assistant.ts` |
| VO-03 | Поиск POI голосом («найди заправку через 100 км», «где ближайшая парковка») | 🟡 PARTIALLY IMPLEMENTED | поиск 0–60 км вперёд с объездом | B-19 | поиск на заданном расстоянии | P2 | `assistant.ts`, `src/services/placesAlongRoute.ts` |
| VO-04 | «Добавь остановку» голосом | 🔴 NOT IMPLEMENTED | — | — | intent `add_stop` | P3 | `parser.ts` |
| VO-05 | Полностью hands-free (без нажатия) | 🔴 NOT IMPLEMENTED | push-to-talk — осознанно | — | wake word (native) | P3 | — |
| VO-06 | Синтез речи, очередь приоритетов, манёвры важнее | ✅ VERIFIED | тесты + E8 | — | — | P1 | `src/voice/queue.ts` |
| VO-07 | Ошибки и разрешения микрофона | 🟢 IMPLEMENTED | `micDenied`, `unsupported` | — | — | P2 | `assistant.ts` |
| VO-08 | Голосовые вопросы о поездке («где ночуем?») | 🔴 NOT IMPLEMENTED | — | — | — | P3 | — |

### 3.10 UX, мобильная готовность, производительность

| ID | Требование | Статус | Реализация | Баги | Что отсутствует | Приоритет | Файл |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UX-01 | Адаптивность: боковая панель / нижний лист | ✅ VERIFIED | E5 (375 px и десктоп) | — | — | P0 | `src/components/BottomSheet/*` |
| UX-02 | Состояния: загрузка, пусто, ошибка, офлайн, нет разрешения, нет маршрута, нет погоды | 🟢 IMPLEMENTED | спиннеры стадий, тексты ошибок, метки офлайн/устарело | B-12 | ошибки тайлов (MAP-05) | P1 | `src/components/Plan/PlanSheet.tsx`, `src/components/Notice/Notice.tsx` |
| UX-03 | Онбординг | 🟡 PARTIALLY IMPLEMENTED | слоган + демо-маршрут | — | объяснение ограничений web-навигации и приватности | P2 | `PlanSheet.tsx` (`Intro`) |
| UX-04 | Профиль / аккаунт | 🔴 NOT IMPLEMENTED | по решению (anonymous-first) | — | — | P3 | ADR-008 |
| UX-05 | Настройки | ✅ VERIFIED | `SettingsDialog.test.tsx` | — | — | P1 | `SettingsDialog.tsx` |
| UX-06 | Сводка поездки при прибытии | 🟢 IMPLEMENTED | `ArrivalSheet` | — | — | P3 | `src/components/Drive/ArrivalSheet.tsx` |
| MOB-01 | Движки без React/DOM (общее ядро для mobile) | ✅ VERIFIED | grep по `algorithms/intelligence/navigation/trip/types` (E12) | — | — | P0 | `src/algorithms`, `src/intelligence`, `src/navigation`, `src/trip`, `src/types` |
| MOB-02 | Абстракция GPS | 🟡 PARTIALLY IMPLEMENTED | внедряемый `Env.geo`, формального интерфейса нет | — | `LocationProvider` | P2 | `src/services/location.ts` |
| MOB-03 | Абстракция уведомлений | 🔴 NOT IMPLEMENTED | — | — | — | P2 | — |
| MOB-04 | Версионированный API `/api/v1` | ✅ VERIFIED | `v1.test.ts`, smoke на обоих префиксах | — | — | P0 | `src/api/v1.ts`, `worker/index.ts` |
| MOB-05 | Bearer-авторизация для нативных клиентов | 🔴 NOT IMPLEMENTED | PLANNED (нет аккаунтов) | — | — | P2 | ADR-008 |
| MOB-06 | iOS / Android / CarPlay / Android Auto | 🔴 NOT IMPLEMENTED | PLANNED / FUTURE | — | ADR-010 spike | P3 | `docs/mobile/MOBILE_STRATEGY.md` |
| MOB-07 | Навигация в фоне / при заблокированном экране | 🔴 NOT IMPLEMENTED | ограничение web (есть Wake Lock) | — | native | P2 | `src/hooks/useWakeLock.ts` |
| MOB-08 | Тач-таргеты ≥44 px | 🟢 IMPLEMENTED | по документам; скан: маркеры и атрибуция <24 px | — | — | P2 | — |
| PF-01 | Размер бандла | 🟡 PARTIALLY IMPLEMENTED | main 604 KB / 196 KB gzip; MapLibre лениво | — | code-splitting редких экранов | P2 | `vite.config.ts` |
| PF-02 | Core Web Vitals измерены | 🔴 NOT IMPLEMENTED | — | — | замер на среднем телефоне | P1 | — |
| PF-03 | Обновление позиции без сетевых запросов | ✅ VERIFIED | прогноз пересопоставляется локально (тесты) | — | — | P0 | `store.ts` |
| PF-04 | Троттлинг `derive` ≤1 раз/с в реальной навигации | ⚠️ BROKEN | — | B-10 | — | P2 | `store.ts:449`, `store.ts:1640` |
| PF-05 | Ограниченная память в долгой сессии | 🟡 PARTIALLY IMPLEMENTED | кэш `WeatherService` ≤500 записей | B-11 | — | P3 | `store.ts` |
| PF-06 | Нет лишних запросов | 🟢 IMPLEMENTED | батчи, дедуп; оправданные: 4 via-пробы на план, проверка погодного объезда раз в 10 мин (≈5 запросов роутинга) | — | — | P2 | `routePlanner.ts`, `store.ts` |

### 3.11 Cloudflare, данные, безопасность, приватность, лицензии

| ID | Требование | Статус | Реализация | Баги | Что отсутствует | Приоритет | Файл |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CF-01 | Один Worker со static assets | 🟢 IMPLEMENTED | локально через `wrangler dev` (E4) | — | — | P0 | `wrangler.toml`, `worker/index.ts` |
| CF-02 | Durable Objects только там, где нужно | 🟢 IMPLEMENTED | `LiveShare` на ссылку, `Reports` один | — | шардирование | P1 | `worker/liveShare.ts`, `worker/reports.ts` |
| CF-03 | Rate limits на запись и чтение отчётов, планировщик | ✅ VERIFIED | smoke (E4) | — | `/whereami` без лимита | P0 | `wrangler.toml` |
| CF-04 | Логи / наблюдаемость | 🔴 NOT IMPLEMENTED | `observability.enabled=false` | — | — | P1 | `wrangler.toml` |
| CF-05 | Разделение prod / preview / staging | 🔴 NOT IMPLEMENTED | preview использует prod-неймспейсы DO | — | `[env.preview]` | P2 | `wrangler.toml`, `docs/operations/DELIVERY.md` |
| CF-06 | Edge Cache API для мест и границ | ❓ UNKNOWN / NEEDS VERIFICATION | код корректен; поведение на `*.workers.dev` не проверено | — | свой домен | P2 | `worker/trips.ts` |
| CF-07 | CPU на Workers Free (10 мс) для `/trips/plan` | ❓ UNKNOWN / NEEDS VERIFICATION | локально 116 мс wall на 1,200 км | — | замер в проде | P1 | `worker/trips.ts` |
| CF-08 | Продакшн-деплой существует и работает | ❓ UNKNOWN / NEEDS VERIFICATION | признаков деплоя нет | — | — | P1 | `.github/workflows/deploy.yml` |
| CF-09 | Секреты не в клиенте | ✅ VERIFIED | секретов нет; все `VITE_*` публичные | — | — | P0 | `.env.example` |
| CF-10 | Масштаб `Reports` (один глобальный DO) | 🟡 PARTIALLY IMPLEMENTED | достаточно до ~1k DAU | — | шардинг + «коридор» | P2 | `worker/reports.ts` |
| DB-01 | Без серверной БД на этапе MVP | 🟢 IMPLEMENTED | по ADR-007 | — | — | P0 | — |
| DB-02 | Схема `Reports` (индексы, TTL, очистка) | 🟢 IMPLEMENTED | индексы `lat`, `expires_at`; почасовой alarm | B-17 | — | P2 | `worker/reports.ts` |
| DB-03 | D1 для аккаунтов (миграция 0001) | 🔴 NOT IMPLEMENTED | PROPOSED, не применена | — | — | P3 | `database/migrations/0001_accounts.sql` |
| SEC-01 | CSP, Permissions-Policy, nosniff, Referrer-Policy | 🟢 IMPLEMENTED | `public/_headers` | — | HSTS (на зоне), CSP-отчёты | P0 | `public/_headers` |
| SEC-02 | CSRF (`Sec-Fetch-Site`), только JSON | ✅ VERIFIED | smoke | — | — | P0 | `worker/index.ts` |
| SEC-03 | Ссылки-капабилити ≥128 бит, ключ хранится только как SHA-256 | ✅ VERIFIED | smoke | — | — | P0 | `worker/index.ts`, `worker/liveShare.ts` |
| SEC-04 | Ключ отправителя шаринга в `localStorage` | 🟡 PARTIALLY IMPLEMENTED | риск XSS снижен строгим CSP | — | — | P3 | `src/share/liveShare.ts` |
| SEC-05 | Модерация / антиабьюз сообщений водителей | 🔴 NOT IMPLEMENTED | только rate limit + 30/сутки | — | инструменты модерации | P2 | `worker/reports.ts` |
| SEC-06 | Уязвимые зависимости | ⚠️ BROKEN | prod 0; dev 1 high | B-16 | — | P2 | `package.json` |
| SEC-07 | WAF / Turnstile | 🔴 NOT IMPLEMENTED | PLANNED | — | — | P2 | — |
| SEC-08 | Линтер / статический анализ в CI | 🔴 NOT IMPLEMENTED | `eslint-disable` есть, ESLint нет | — | — | P2 | — |
| SEC-09 | Валидация входа Worker (размер тела, координаты, типы) | ✅ VERIFIED | санитайзеры протоколов, smoke | — | — | P0 | `src/share/protocol.ts`, `src/reports/protocol.ts`, `src/trip/protocol.ts` |
| PRV-01 | Нет истории местоположений на сервере | ✅ VERIFIED | `LiveShare` — только последняя точка; планировщик stateless; отчёты — вид + точка | — | — | P0 | `worker/*` |
| PRV-02 | Третьи стороны получают только нужное | 🟢 IMPLEMENTED | задокументировано по провайдерам | — | — | P0 | `docs/legal/PRIVACY.md` |
| PRV-03 | Политика конфиденциальности / Условия опубликованы | 🔴 NOT IMPLEMENTED | — | — | — | P1 | — |
| PRV-04 | Локальные данные (настройки, места, недавние) с opt-out | 🟢 IMPLEMENTED | — | — | — | P1 | `src/state/savedPlaces.ts` |
| PRV-05 | Без аналитики и cookies | ✅ VERIFIED | трекеров нет (код, сеть E5) | — | — | P1 | — |
| PRV-06 | Псевдоним отправителя отчёта | 🟡 PARTIALLY IMPLEMENTED | суточная соль | B-17 | — | P3 | `worker/reports.ts` |
| LIC-01 | Атрибуция всех источников | 🟢 IMPLEMENTED | — | B-13 | — | P0 | `Attribution.tsx` |
| LIC-02 | Условия Transitous (open source, некоммерческий проект, контакт) | ⚠️ BROKEN | используется при закрытом репозитории без лицензии | — | решение владельца | P1 | `src/services/routing/TransitousProvider.ts` |
| LIC-03 | Open-Meteo free (<10k вызовов/сутки на приложение) | ⚠️ BROKEN | превышается при ~30 DAU (клиент ходит напрямую) | — | платный ключ + edge-кэш | P1 | `OpenMeteoProvider.ts` |
| LIC-04 | Лицензия кода | 🔴 NOT IMPLEMENTED | — | — | решение владельца | P2 | — |
| LIC-05 | User-Agent к Overpass с контактом | 🟡 PARTIALLY IMPLEMENTED | UA без контакта | — | контакт | P2 | `wrangler.toml` `[vars]` |
| LIC-06 | Камеры скорости включены по умолчанию (законность) | 🟡 PARTIALLY IMPLEMENTED | предупреждение об ответственности | — | дефолт по стране | P2 | `src/state/settings.ts` |

### 3.12 Тесты, документация, локализация, офлайн, доступность

| ID | Требование | Статус | Реализация | Баги | Что отсутствует | Приоритет | Файл |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TST-01 | Юнит- и сценарные тесты движков | ✅ VERIFIED | 586 пройдено (E1) | — | — | P0 | `src/**/*.test.ts(x)` |
| TST-02 | Smoke-тесты Worker | ✅ VERIFIED | 16/16 локально (E4) | — | — | P0 | `scripts/*.mjs` |
| TST-03 | Браузерные E2E (Playwright) | 🔴 NOT IMPLEMENTED | — | — | — | P2 | — |
| TST-04 | Тесты на реальных устройствах | 🔴 NOT IMPLEMENTED | — | — | — | P1 | — |
| TST-05 | CI действительно выполняется | ❓ UNKNOWN / NEEDS VERIFICATION | `ci.yml` есть; история запусков недоступна | — | — | P1 | `.github/workflows/ci.yml` |
| TST-06 | Регрессионные тесты на найденные дефекты (B-01…B-07) | 🔴 NOT IMPLEMENTED | — | — | — | P0 | `src/trip/trip.test.ts`, `src/state/trip.test.tsx` |
| TST-07 | Живой интеграционный тест провайдеров | 🟡 PARTIALLY IMPLEMENTED | `test:live` (по требованию) | — | регулярный запуск | P3 | `src/integration/live.test.ts` |
| DOC-01 | `PROJECT_REQUIREMENTS.md` соответствует коду | 🟡 PARTIALLY IMPLEMENTED | «VERIFIED» у требований с подтверждёнными дефектами; «548 тестов» вместо 586 | — | — | P1 | `docs/PROJECT_REQUIREMENTS.md` |
| DOC-02 | `docs/runbooks/` | 🔴 NOT IMPLEMENTED | — | — | инциденты, отказ провайдеров, откат, ротация | P2 | — |
| DOC-03 | `/plan.md` в корне | 🔴 NOT IMPLEMENTED | есть `docs/PLAN.md` | — | (отдельный файл не нужен) | P3 | `docs/PLAN.md` |
| DOC-04 | Архитектурные документы актуальны | 🟡 PARTIALLY IMPLEMENTED | вступление `ARCHITECTURE.md` («Worker для live sharing») устарело; `DELIVERY.md` не упоминает `test:trips` | — | — | P3 | `docs/ARCHITECTURE.md`, `docs/operations/DELIVERY.md` |
| I18N-01 | en/ru, без захардкоженного текста | 🟢 IMPLEMENTED | — | — | ревью носителем ru | P1 | `src/i18n/*` |
| I18N-02 | Грузинский интерфейс | 🔴 NOT IMPLEMENTED | CONFLICT (удалён владельцем, бриф требует) | — | решение владельца | P2 | — |
| I18N-03 | Единицы, часовые пояса, DST | ✅ VERIFIED | `timezone.test.ts` | — | — | P0 | `src/utils/timezone.ts` |
| OFF-01 | Офлайн-оболочка; маршрут и прогнозы остаются с меткой «устарело» | 🟢 IMPLEMENTED | `serviceWorker.test.ts`, сценарий потери сети | B-12 | precache ленивых чанков | P1 | `public/sw.js` |
| A11Y-01 | WCAG 2.1 AA (axe 0 нарушений по документам) | 🟢 IMPLEMENTED | скан E11 без нарушений имён | — | axe в CI | P1 | — |

---

## 4. Подтверждённые дефекты

«CONFIRMED» — воспроизведено тестом или в браузере, либо однозначно следует из кода; «PLAUSIBLE» — вероятно, не воспроизведено.

| ID | Приоритет | Дефект | Воспроизведение / доказательство | Где |
| --- | --- | --- | --- | --- |
| **B-01** | **P0** | **Остаток топлива не передаётся при перепланировании** → заправка переносится дальше реального запаса хода (риск остаться без топлива) | E9c: запас 500 км, заправка на 338 км; перепланирование на 300 км (+30 мин) → заправка на **660 км**. `checkProgress` вызывает `progressStateFor` без `rangeKm`; перенос при перестроении (`carry`) тоже без него; планировщик берёт `progress?.rangeKm ?? req.vehicle.rangeKm` (запас на старте) | `src/state/trip.ts:292`, `src/state/trip.ts` (`refresh`, `carry`), `src/trip/planning/planner.ts` (`rangeLeftKm`) — CONFIRMED |
| **B-02** | **P0** | **Обычное напоминание о заправке «уезжает» вместе с машиной**: точка всегда на 70 % запаса впереди и никогда не приближается | `at = progressM + rangeM * 0.7` при неизменном `fuelRangeKm`; тесты только при `progressM = 0` | `src/intelligence/routeIntelligence.ts` (блок «Fuel / charging») — CONFIRMED (код) |
| **B-03** | P1 | Стоянка на **запланированной** остановке считается опозданием → ложное перепланирование и уведомление «прибытие сдвинулось» | E9a: через 25 мин 45-минутного обеда `delaySeconds` = 1,500 с ≥ порога 1,200 с (и −1,200 с, если машина на 1 м дальше точки) | `src/trip/replanning/progress.ts` (`plannedTimeAt`, `delaySeconds`), `src/state/trip.ts` (`checkProgress`) — CONFIRMED |
| **B-04** | P1 | **Ночной выезд даёт неправдоподобный план**: 9 ч вождения ночью, «ночёвка» днём (09:22–18:22), вторая ночёвка через 3.6 ч, ужин помечен съеденным при любой ночёвке → 1 приём пищи за 41 ч | E6 (живой план Tbilisi → Istanbul, выезд 00:23) | `src/trip/planning/schedule.ts` (`overnightIn`, `eaten.add(…:dinner)`, расчёт `dwellS`) — CONFIRMED |
| **B-05** | P1 | **Первый план Long Trip строится до загрузки посёлков** (late places) → у ночёвок нет городов и альтернатив; автоматически не обновляется | E6: после ручного «Повторить» появились Giresun / Samsun и альтернативы (Keşap, Bulancak…) | `src/state/trip.ts` (подписки только на id маршрута и `weatherStatus`), `src/services/routePlanner.ts` (`latePlaces`) — CONFIRMED |
| **B-06** | P1 | **Горизонт прогноза для многодневной поездки**: первая загрузка игнорирует запланированные остановки → прогноз на 48 ч, больше половины точки «без прогноза» до следующего обновления (≤20 мин) | E7: 77/145 точек без погоды; прогноз до +48 ч при прибытии через 4.5 дня | `src/state/store.ts` (`loadWeather`, `latestArrival`), `WeatherService.ts` — CONFIRMED |
| **B-07** | P1 | **Риски и советы Long Trip не пересчитываются**, когда в режиме планирования пришёл новый/более длинный прогноз | E7: после второй загрузки риски не изменились (8, все в день 1); подписка на `weatherStatus` срабатывает только при `!plan || error` | `src/state/trip.ts` (`initTrip`) — CONFIRMED |
| B-08 | P2 | Пороги опасностей расходятся между алертами и рисками поездки (и сравнением дорог / полоской погоды): порывы 60 vs 70, гололёд ≤1 °C vs ≤0.5 °C, мокрый снег = гололёд vs снег; комментарий утверждает «те же пороги» | E9b | `src/trip/weather/hazards.ts`, `weatherAlerts.ts`, `derive.ts:320-327`, `departurePlanner.ts`, `WeatherStrip.tsx:122`, `roadHazards.ts:196` — CONFIRMED |
| B-09 | P2 | Коды опасностей для поездки: состояние и порывы берутся из часа *до* (индекс `i`), осадки — из `i+1` → опасности по коду погоды сдвинуты ~на 1 ч относительно сопоставления в приложении | чтение кода | `src/services/trip/requests.ts` (`weatherSamples`) — CONFIRMED (код) |
| B-10 | P2 | Троттлинг `derive` отключён в реальной навигации: `lastDeriveSimMs = s.sim.nowMs` (= 0) → условие `progress.nowMs - lastDeriveSimMs >= 30000` всегда истинно → `derive` и оценка алертов на каждый GPS-фикс | чтение кода | `src/state/store.ts:449`, `:1640` — CONFIRMED (код) |
| B-11 | P3 | `forecasts` в store никогда не очищается (растёт за сессию) | чтение кода | `store.ts` (`loadWeather`) — CONFIRMED (код) |
| B-12 | P3 | Офлайн: ленивые чанки (Settings, LongTripDetails) не кэшируются заранее → первое открытие офлайн может закончиться экраном сбоя | чтение кода | `public/sw.js`, `src/App.tsx` — PLAUSIBLE |
| B-13 | P3 | Атрибуция «Routing: OSRM on FOSSGIS servers», хотя авто-маршруты идут через `router.project-osrm.org` | чтение кода | `src/i18n/en.ts:470`, `ru.ts` — CONFIRMED |
| B-14 | P3 | Дубли событий камер в одной точке (+43 мин ×2, +90/+91) | E8 | `src/algorithms/cameras.ts` — PLAUSIBLE (две камеры по направлениям?) |
| B-15 | P3 | Предупреждение MapLibre `Image "circle-11" could not be loaded` | консоль E5 | слой/стиль карты — PLAUSIBLE |
| B-16 | P2 | Уязвимость в dev-цепочке: `wrangler 4.142` → `miniflare` → `undici` (high) | E10 | `package.json` — CONFIRMED |
| B-17 | P3 | Соль псевдонима отчётов меняется раз в сутки: проверки «свой отчёт / повторный голос» сбрасываются в полночь UTC; в течение суток отчёты одного IP связаны | чтение кода | `worker/reports.ts` (`who`) — CONFIRMED (код) |
| B-19 | P2 | Голос: «найди заправку через 100 км» / «через 100 километров» — расстояние игнорируется, ищется в 0–60 км | чтение кода | `src/voice/parser.ts`, `store.ts` (`searchPoi`) — CONFIRMED (код) |
| B-20 | P2 | Если указан остаток, но не размер бака/расход, после первой заправки остальные не планируются — без предупреждения | `fillRangeM = fullRangeM` (undefined); совет `enter-range` только при отсутствии остатка | `schedule.ts`, `planner.ts` — CONFIRMED (код) |
| B-22 | P1 | Кэш мест и границ в Worker построен на Cache API, который **не работает на `*.workers.dev`** → каждый вызов идёт в публичный Overpass | официальная документация Cloudflare (2026-10-03) | `worker/trips.ts` (`edgeCache`, `tripBorders`) — CONFIRMED (документация) |
| B-23 | P1 | Планировщик Long Trip на Worker превышает лимит CPU плана Free (10 мс): 10.5 мс на 1,600 км, 78 мс на 3,800 км в тёплом V8 (холодный изолят медленнее) | временный замер (удалён) | `worker/trips.ts`, `src/trip/planning/*` — CONFIRMED (замер) |
| B-21 | P2 | Отсутствие прогноза в рисках поездки трактуется как «нет опасности»; коды передаются максимум на 96 ч | `HAZARD_CODES[Math.max(0, -1)]` → `null`; `weatherSamples(…, hours = 96)` | `src/trip/weather/risks.ts`, `src/services/trip/requests.ts` — CONFIRMED (код) |

---

## 5. Расхождения «документация ↔ код»

| Документ утверждает | Факт | Действие |
| --- | --- | --- |
| REQ-TRIP-007 «Fuel … VERIFIED» | B-01, B-20 | статус → DEFECT |
| REQ-TRIP-010 «Replan … VERIFIED» | B-01, B-03 | статус → DEFECT |
| REQ-TRIP-003 / 005 «schedule, overnight areas VERIFIED» | B-04, B-05 | статус → DEFECT |
| REQ-TRIP-009 «weather risks … VERIFIED» | B-07, B-08, B-21 | статус → DEFECT |
| REQ-WX-001 «… VERIFIED» | верно для поездок ≤ ~46 ч; B-06 для многодневных | новое требование REQ-WX-008 |
| `hazards.ts`: «Same thresholds as the alert engine» | разные пороги (B-08) | исправить код или комментарий; REQ-WX-009 |
| REQ-TEST-001 «currently 548» | 586 | обновлено |
| `ARCHITECTURE.md`: «small Cloudflare Worker for live location sharing» | Worker: шаринг, отчёты, whereami, планировщик поездок | обновить вступление (P3) |
| `TESTING.md`: живой OSRM `alternatives=3` не проверен | проверен 2026-10-03 (E5): ответ корректный, via-пробы дали альтернативу | обновлено |
| Задание: `/docs/runbooks/`, `/plan.md` | отсутствуют (`docs/PLAN.md` есть) | DOC-02 / DOC-03 |
| Атрибуция «OSRM on FOSSGIS servers» | авто: Project OSRM demo | B-13 |

Требований, которые больше не актуальны, не найдено — **ни одно не помечено DEPRECATED**.

---

## 6. Проверка ядра продукта по этапам

| Этап | Статус | Доказательство |
| --- | --- | --- |
| Открыть приложение | ✅ VERIFIED | E5 |
| Указать старт (вкл. «моё местоположение» / приблизительно) | ✅ VERIFIED | E5, `location.test.ts` |
| Указать назначение | ✅ VERIFIED | E5 |
| Рассчитать маршрут | ✅ VERIFIED | E5 (OSRM, 1 + 4 запроса через очередь) |
| Показать маршрут | ✅ VERIFIED | E5 (скриншоты desktop / 375 px) |
| Рассчитать ETA | ✅ VERIFIED | per-edge длительности; E5 «Arrive 05:14» |
| Получить погоду вдоль маршрута | ✅ / ⚠️ | ✅ до ~46 ч; ⚠️ многодневные (B-06) |
| Сопоставить погоду с ETA | ✅ VERIFIED | `weatherMatching.test.ts`; E5 — у каждой точки своё местное время |
| Обнаружить риски | 🟢 IMPLEMENTED | тесты; расхождение порогов (B-08) |
| Создать предупреждения | ✅ VERIFIED | E8 |
| Навигация | 🟢 IMPLEMENTED | симуляция E8; без реального устройства |
| Пересчёт при изменении условий | 🟢 / ⚠️ | обычный режим — 🟢; Long Trip — ⚠️ (B-01, B-03, B-07) |

**Вывод:** основной сценарий «маршрут → ETA → прогноз на время прибытия → предупреждение» реально работает на живых
провайдерах. Слабые места — многодневные поездки, перепланирование Long Trip и надёжность бесплатных провайдеров
(Overpass отказал в живом прогоне).

---

## 7. Cloudflare

| Сервис | Используется | Нужен ли | Замечания |
| --- | --- | --- | --- |
| Workers + static assets | да | да | один Worker обслуживает SPA и `/api/*`; `run_worker_first = ["/api/*"]` |
| Durable Objects (SQLite) | `LiveShare` (на ссылку), `Reports` (один) | да (согласованное состояние) | `Reports` — единая точка: шардирование до ~1,000 req/s (REQ-CF-008) |
| Rate limiting binding | 4 namespace (create 6/мин, report 10/мин, list 120/мин, trips 20/мин) | да | лимиты на IP и локацию; CGNAT может задеть невиновных; `/whereami` без лимита |
| Cache API | trips places (24 ч), borders (7 дней) | да | на `*.workers.dev` может не работать — ❓ (CF-06) |
| D1 / KV / R2 / Queues / Cron | нет | **не нужны сейчас** | корректно не добавлены; триггеры описаны в `TARGET_ARCHITECTURE.md` |
| Observability (Workers Logs) | выключено | нужно перед бетой | без координат в URL (REQ-PRIV-004) |
| Окружения | одно | нужно `[env.preview]`/staging | preview пишет в prod-DO |
| Секреты | нет | — | `TRIP_USER_AGENT` без контакта |
| Деплой / откат | `deploy.yml` (ручной), `wrangler rollback` | — | факт деплоя ❓; DO-данные откатом не возвращаются (протоколы аддитивны) |
| Миграции | DO: `v1`, `v2` (`new_sqlite_classes`) | — | D1-миграция — только предложение |

## 8. База данных

- Серверной БД нет (ADR-007). Хранилища: SQLite внутри `Reports` DO (`reports`, `votes`, `meta`), KV-хранилище DO
  для `LiveShare` (`meta`, `state`).
- `reports`: PK `id`, индексы `lat`, `expires_at`; запрос bbox использует только индекс по широте (приемлемо до
  десятков тысяч строк); лимит 50,000 активных, 400 в выдаче. Очистка — почасовой alarm (сначала голоса, потом
  отчёты). Сиротских голосов не остаётся. Инъекций нет (только параметризованные `sql.exec`).
- Гонки: DO однопоточен; `addVote` (SELECT, затем INSERT) безопасен внутри DO; PK `(report_id, voter)` страхует.
- Пользовательские данные на клиенте: `navweather.settings.v1`, `navweather.places.v1` (места, недавние, парковка),
  `navweather.share.v1` (ключ шаринга), sessionStorage `navweather.drive.v1` (назначение + оставшиеся остановки).
- `0001_accounts.sql` — PROPOSED, не применена; миграционная стратегия описана (expand → migrate → contract).

## 9. Безопасность

Сильные стороны: строгий CSP без `unsafe-inline`, `frame-ancestors 'none'`; CSRF по `Sec-Fetch-Site`; только JSON;
тела с жёстким лимитом при потоковом чтении; ссылки-капабилити 128 бит; ключ 256 бит хранится как SHA-256 и
сравнивается за постоянное время; проверка времени и порядка обновлений; удаление управляющих/двунаправленных
символов из имён; фиксированные фильтры Overpass (пользовательский ввод не попадает в Overpass QL); prod-зависимости
без уязвимостей.

Проблемы: B-16 (dev high); нет ESLint/SAST; нет WAF/Turnstile; нет модерации отчётов; `/whereami` без лимита;
ключ шаринга в `localStorage`; нет HSTS в `_headers` (ставится на зоне Cloudflare); B-17.

### Данные о местоположении (что, зачем, сколько, удаление, доступ)

| Данные | Где | Зачем | Срок хранения | Удаление | Доступ |
| --- | --- | --- | --- | --- | --- |
| Последняя позиция + геометрия маршрута + назначение / ETA при шаринге | DO `LiveShare` | показать зрителям | до остановки или окончания (1–24 ч), сохранение не чаще 15 с | `DELETE` отправителем или alarm при истечении (`deleteAll`) | владельцы ссылки; Cloudflare |
| Вид + координаты (5 знаков) сообщения, время, хэш отправителя | DO `Reports` | показать водителям | время жизни вида (45 мин…12 ч), максимум ×3 (≤36 ч) | почасовой alarm | все, кто запрашивает область (без данных об отправителе) |
| Ресэмплированный маршрут, посёлки, отправление, ТС / запас, коды опасностей, позиция на маршруте | Worker `/trips/plan` | построить план | не хранится, не логируется | — | Cloudflare (транзитно) |
| Точки маршрута для мест и границ | Worker → Overpass; edge-кэш (ключ — координаты, округлённые до 0.01°) | места и страны | кэш 24 ч / 7 дней (списки мест, не пользователей) | истечение кэша | Overpass, Cloudflare |
| Город по IP | Worker `/whereami` | старт, если нет GPS | не хранится | — | — |
| Координаты маршрута и запросов напрямую из браузера | OSRM, Open-Meteo (4 знака), Nominatim, Photon, Overpass, OpenFreeMap (по тайлам виден viewport), Transitous, Google (текст TTS) | работа функций | по политикам провайдеров | — | провайдеры видят IP |
| Настройки, места, недавние, парковка | `localStorage` устройства | удобство | пока пользователь не удалит | Настройки → очистить | только устройство |

## 10. Приватность

Минимизация соблюдается: нет аккаунтов, аналитики, cookies; позиции и маршруты не хранятся на сервере; шаринг
удаляется по истечении. Не хватает публичной **Privacy Policy / Terms / страницы удаления данных** (PRV-03) и
явного раскрытия того, что OpenFreeMap / Open-Meteo / OSRM видят IP и координаты (сейчас — в `docs/legal/PRIVACY.md`,
не в интерфейсе). Реально необходимые данные: координаты маршрута (роутинг, погода), текущая позиция (только во
время навигации и шаринга), предпочтения (на устройстве). Всё остальное не собирается — корректно.

## 11. API и сторонние сервисы

| Провайдер | Назначение | API | Бесплатно | Стоимость | Лимиты | Авторизация | Поведение при отказе | Резерв | Лицензия | Атрибуция |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OpenFreeMap | векторные тайлы, стили | `tiles.openfreemap.org/styles/*` | да | $0 (не наш счёт) | не заявлены, без SLA | нет | пустая карта; «карта недоступна» до загрузки стиля | нет (PMTiles — план) | ODbL + OpenMapTiles (BSD-3 / CC-BY) | ✔ на карте |
| MapLibre GL JS | рендер | npm | да | $0 | — | — | — | — | BSD-3 | уведомление в бандле |
| OSRM demo | авто-маршрут, матрица | `/route/v1`, `/table/v1` | некоммерческое | $0 | ≤1 req/s (очередь в приложении) | нет | «сервис занят / проверьте связь» | нет (свой роутер — план) | BSD-2 (ПО), ODbL (данные) | ⚠️ текст неточный (B-13) |
| FOSSGIS (routing.openstreetmap.de) | пешком / велосипед | OSRM API | да | $0 | 1 req/s | нет | ошибка маршрута | нет | — | ✔ + «Report a map error» |
| Transitous (MOTIS) | общественный транспорт | `/api/v5/plan` | некоммерческие open-source проекты | $0 | «связаться перед использованием» | нет | «транспорт не найден» + ссылка | нет | условия **не выполнены** (LIC-02) | ✔ ссылка на источники |
| Open-Meteo | прогноз, высоты, качество воздуха | `/v1/forecast`, `/v1/elevation`, air-quality | <10k/сутки, 5k/ч, 600/мин, 300k/мес; **некоммерческое** | Standard 1M/мес (~$29/мес по сторонним источникам), Professional 5M, Enterprise 50M+ — официальные цены не опубликованы | >10 переменных или >2 недель = несколько вызовов | нет (платные — ключ) | устаревший кэш с меткой; иначе «погода недоступна» | нет | CC BY 4.0 | ✔ |
| Nominatim | геокодинг | `/search`, `/reverse` | да | $0 | ≤1 req/s, без автодополнения | нет | «не найдено / сервис занят» | Photon | ODbL | ✔ |
| Photon (komoot) | автодополнение, reverse | `/api`, `/reverse` | fair use | $0 | не определены | нет | без подсказок | Nominatim (набранный текст) | ODbL | ✔ |
| Overpass (2 публичных) | посёлки, POI, лимиты, камеры, переезды; места и границы для поездок (из Worker) | `/api/interpreter` | fair use (~10k запросов/сутки для «casual») | $0 | «регулярным приложениям ~100/сутки» | нет | мягкие дедлайны, «места недоступны»; **живой прогон: оба отказали** | второй инстанс | ODbL | через OSM |
| Cloudflare Workers / DO / RL / Cache | хостинг, API | — | 100k req/сутки (Free) | Paid $5/мес + $0.30/M req; DO $0.15/M | Free: 10 мс CPU | токен деплоя | — | — | — | — |
| Web Speech / Google voices | TTS, push-to-talk | браузер | да | $0 | — | — | голос устройства | голос устройства | — | раскрыто в настройках |
| Отели | — | **нет** (только OSM) | — | — | — | — | «доступность не проверяется» | — | — | — |
| Цены на топливо, трафик, ожидание на границе, push | — | **нет источника** | — | — | — | — | NOT AVAILABLE | — | — | — |

## 12. Стоимость

Допущения: «пользователи» = **DAU** (MAU ≈ 3–5 × DAU). На 1 DAU (оценка по коду и живым прогонам E5–E7): Open-Meteo
≈ **350 взвешенных вызовов** (план по 3 дорогам ≈ 98; слой погоды 49 точек ≈ 69; обновление каждые 20 мин в пути ≈ 70;
многодневный план — 200–400); роутинг ≈ 14 (план = 1 + 4 via-пробы; проверка погодного объезда в непогоду ≈ 5 раз в
10 мин); геокодинг ≈ 30 (в E5 8 reverse-запросов на один план); Overpass ≈ 3.5; Worker ≈ 105 запросов (после
«коридора» ≈ 25). Цены Cloudflare — опубликованные 2026-10-02; цены Open-Meteo **не опубликованы** (сторонние
источники: Standard ≈ $29/мес); вычислительные ресурсы для роутинга — оценка.

| Компонент (в месяц) | 100 DAU | 1,000 DAU | 10,000 DAU | 100,000 DAU | 1,000,000 DAU |
| --- | --- | --- | --- | --- | --- |
| Погода напрямую (сейчас) | 1.05M вызовов → **за пределами free** (10k/сутки) → Standard/Professional | 10.5M → Enterprise | 105M | 1.05B | 10.5B — невозможно |
| Погода через edge-кэш (ячейка + прогон модели) | ~0.1–0.2M → Free/Standard ($0–29) | ~0.6–1.7M → Standard–Professional | ~1.2–1.7M (Грузия) → Professional | международно 5–50M → Professional / Enterprise | Enterprise или self-host Open-Meteo (~$0.5–2k) |
| Workers | Free | Paid $5 (3.2M req) | $5–12 (после «коридора» $5) | ≈ $27 после «коридора» (≈ $92 без него) | ≈ $256 (≈ $940 без него) |
| Durable Objects | $0 | ≈ $0.3 | ≈ $1–4 | ≈ $10–40 | ≈ $100+ + шардирование `Reports` (обязательно) |
| Роутинг | публичный OSRM ($0, некоммерческий) | свой Valhalla: ≈ $50 (VM / Containers) | ≈ $50–100 | ≈ $185–400 | кластер ≈ $1–3k |
| Геокодинг | публичный ($0) | Photon self-host ≈ $0–50 (на той же VM) | ≈ $50–100 | ≈ $100–200 | ≈ $0.5–1k |
| Overpass / POI | публичный ($0) | выгрузка OSM / свой Overpass ≈ $20–50 | ≈ $50 | ≈ $100 | ≈ $300+ |
| Тайлы | OpenFreeMap ($0) | $0 | $0 (поддержать проект) | self-host ≈ $200 | ≈ $1.8–2.2k (нужен CDN-кэш статических тайлов) |
| Хранилище | $0 | $0 | $0 | $0 | ≈ $0–5 (D1 при аккаунтах) |
| Уведомления | нет | нет | нет | (push не реализован) | — |
| **Итого (порядок)** | **$0–35** | **≈ $100–200** | **≈ $250–400** | **≈ $0.7–1.2k** + план погоды | **≈ $5–10k** |

**Самые дорогие операции:** (1) загрузка прогноза на план и каждые 20 мин в пути — напрямую из браузера, без общего
кэша (доминирует); (2) погодный слой — 49 точек на каждую новую область; (3) веерная выборка отчётов ≤24 запроса
Worker + DO на обновление (доминирует в счёте Cloudflare); (4) проверка погодного объезда — 5 запросов роутинга и
прогноз каждые 10 мин в непогоду; (5) live-шаринг — PUT каждые ≥5 с (720 запросов/ч); (6) многодневные планы — до
150 точек × горизонт до 16 дней (×1.4 за 14 переменных).
**Оптимизации, которые действительно нужны:** edge-кэш погоды `/api/v1/weather/points` (ключ ячейка + прогон
модели) — до ~30 DAU; ≤10 переменных; запрос отчётов «коридором»; ячейки фиксированной сетки для погодного слоя;
шардинг `Reports` к ~100k DAU; кэшируемые статические тайлы к 1M.

## 13. Тестирование

- **Есть:** 586 юнит/сценарных тестов (движки, store-сценарии Tbilisi → Batumi, Long Trip, локализация, SW),
  16 smoke-проверок Worker, опциональный live-тест.
- **Нет:** браузерных E2E, тестов на реальных устройствах, UI-тестов mobile, нагрузочных тестов, axe в CI.
- **Непокрытые критические сценарии:** перепланирование с остатком топлива; стоянка на запланированной остановке;
  ночной выезд; многодневный горизонт прогноза; первый план до загрузки посёлков; продвижение напоминания о
  заправке во время езды.

| Минимальный E2E-сценарий | Покрытие |
| --- | --- |
| Создать маршрут | ✅ store-тесты + живой прогон |
| Начать навигацию | 🟢 store-тесты (без браузера) |
| Погода вдоль маршрута | ✅ |
| Погодное предупреждение | ✅ (тесты + симуляция E8) |
| Пересчёт маршрута | ✅ `scenarios.test.ts` |
| Включение Long Trip | ✅ `trip.test.tsx` |
| Рекомендация отеля | ✅ (фейковый Overpass) + живой E6 |
| Рекомендация топлива | 🟡 (без перепланирования — B-01 не покрыт) |
| Динамическое перепланирование | 🟡 (один сценарий «отстал на 2 ч»; B-03 не покрыт) |
| Отказ API | ✅ |
| Офлайн | ✅ (store-уровень) |
| Отказ GPS | ✅ `location.test.ts` |

## 14. Граничные случаи

| Случай | Статус | Комментарий |
| --- | --- | --- |
| 0 км / старт = финиш | 🟢 | «то же место» при < 50 м |
| Очень длинный маршрут | 🟡 | E7: 3,809 км работает; B-06; ≤6 ночёвок планируется заранее |
| Ровно 800 км / 801 км | ✅ | `>= 800` → LONG (тесты по полосам) |
| 1,000+ км | ✅ | E6 |
| Международный маршрут | ✅ | E6: часовые пояса, страны |
| Пересечение границы | ✅ / 🔴 | обнаружение — да; задержки — NOT AVAILABLE |
| Нет отелей на маршруте | 🟢 | «отели не нанесены на карту» + другие города (тесты) |
| Нет АЗС | 🟢 | совет `no-places` (тесты) |
| Отказ погодного API | ✅ | устаревший кэш / «недоступно» |
| Отказ роутинга | 🟢 | понятная ошибка |
| GPS выключен | ✅ | приблизительный старт; уведомление о запрете |
| Неточный GPS | 🟢 | фильтр по точности (100 м) |
| Нет интернета | 🟢 | метки офлайн; B-12 |
| Смена маршрута | ✅ | |
| Остановка на несколько часов | ⚠️ | Long Trip считает и запланированные стоянки опозданием (B-03) |
| Едет быстрее/медленнее ETA | 🟡 | ETA = сейчас + остаток; без адаптации к темпу |
| Отель стал недоступен | 🔴 | данных о наличии нет — правильно не утверждается |
| Изменение прогноза | 🟢 / ⚠️ | обычный режим — да; риски Long Trip — нет (B-07) |
| Смена часового пояса | ✅ | событие TIMEZONE_CHANGE, тесты |
| Переход на летнее/зимнее время | ✅ | `zonedWallTimeToUtc` (тесты) |
| Ночной выезд (выявлено аудитом) | ⚠️ | B-04 |

## 15. Доступность

По документам — axe-core 0 нарушений в 10 состояниях × 2 темы (раунд 5), ловушки фокуса и Escape в диалогах. Быстрый
скан (E11): у всех элементов есть доступное имя, есть `prefers-reduced-motion`, `lang` выставлен. Мелкие цели:
маркеры погоды на карте и ссылки атрибуции < 24 px. Повторного axe-прогона в CI нет.

## 16. Качество кода

Сильные стороны: строгий TypeScript, нет `any`, нет TODO; чистые движки отделены от UI и сети; интерфейсы провайдеров;
единый `RouteEvent`; осознанная обработка гонок (AbortController, проверки «текущий ли маршрут»).
Долг: `src/state/store.ts` — 2,001 строка (DEBT-001); `RouteMap.tsx` — 753; дублирование порогов погоды (B-08);
связность модулей через модульные переменные (`tracker`, `trip`, `carry`) — тестируется через `__reset…`; нет ESLint
при наличии `eslint-disable`; движки возвращают уже локализованные строки (ядро привязано к i18n — приемлемо,
но учитывать при переносе в mobile). Рефакторинг ради красоты не нужен — только разбить `store.ts` по зонам и
вынести пороги.

## 17. Продуктовый аудит: путь пользователя

| Шаг | Работает | Разрыв |
| --- | --- | --- |
| Discover | карта, погода в центре, карточки мест | нет объяснения ограничений web (фон, блокировка экрана) |
| Plan | дороги с погодой, время выезда, Long Trip | B-04, B-05, B-06/B-07 на длинных поездках; нет «кратчайшего», избегания платных дорог |
| Start | Start / симуляция, праймер разрешения | — |
| Navigate | повороты, голос, ограничения скорости, камеры | без фоновой работы и CarPlay/AA; без реального теста |
| Receive alerts | вовремя, без спама (E8) | только на переднем плане; пороги расходятся (B-08) |
| Adapt | пересчёт, переход на известную дорогу, погодный объезд | Long Trip: B-01, B-03 |
| Stop | перерывы/еда/ночёвки в Long Trip | стоянка считается опозданием (B-03); у пользовательских остановок нет времени стоянки |
| Continue | «Продолжить к …» после перезагрузки | только назначение и остановки |
| Arrive | сводка поездки | не сохраняется (по решению) |

---

## 18. Матрица трассировки требований

| Требование | Документация | Код | Тест | Статус |
| --- | --- | --- | --- | --- |
| Маршрут по реальной геометрии + альтернативы (REQ-CORE-001) | да | да | да + живой | ✅ VERIFIED |
| ETA по каждой вершине (REQ-CORE-002) | да | да | да | ✅ VERIFIED |
| Погода вдоль маршрута ≤ ~46 ч (REQ-CORE-003/004, REQ-WX-001) | да | да | да + живой | ✅ VERIFIED |
| Горизонт прогноза на всю поездку (REQ-WX-008, новое) | нет → добавлено | частично | нет | ⚠️ BROKEN |
| Погодные предупреждения (REQ-CORE-006) | да | да | да + симуляция | ✅ VERIFIED |
| Единые пороги (REQ-WX-009, новое) | нет → добавлено | нет | нет | ⚠️ BROKEN |
| Классификация поездки (REQ-TRIP-001) | да | да | да + живой | ✅ VERIFIED |
| Автовключение Long Trip (REQ-TRIP-002) | да | да | да + живой | ✅ VERIFIED |
| План: перерывы, еда, ночёвки (REQ-TRIP-003/005) | да | да | частично | ⚠️ BROKEN (ночной выезд, B-05) |
| Остановки в каждом ETA (REQ-TRIP-004) | да | да | да | ✅ VERIFIED |
| Отели OSM без доступности (REQ-TRIP-006) | да | да | да + живой | ✅ VERIFIED |
| Топливо (REQ-TRIP-007) | да | да | частично | ⚠️ BROKEN (B-01, B-20) |
| Перепланирование (REQ-TRIP-010) | да | да | частично | ⚠️ BROKEN (B-01, B-03) |
| Погодные риски поездки (REQ-TRIP-009) | да | да | частично | ⚠️ BROKEN (B-07, B-08) |
| Границы (REQ-TRIP-012) | да | да | да + живой | ✅ VERIFIED |
| Truck-ограничения (REQ-TRIP-013) | да | нет | нет | 🔴 NOT IMPLEMENTED (BLOCKED) |
| Наличие мест в отеле / цены топлива (REQ-TRIP-017) | да | нет (верно) | — | 🔴 NOT IMPLEMENTED (BLOCKED) |
| Голосовой ассистент | частично (README, ARCHITECTURE) | да | парсер | 🟢 IMPLEMENTED |
| Официальные предупреждения (REQ-WX-006) | да | нет | нет | 🔴 NOT IMPLEMENTED |
| Edge-кэш погоды (REQ-WX-005) | да | нет | нет | 🔴 NOT IMPLEMENTED |
| `/api/v1` (REQ-API-001) | да | да | да | ✅ VERIFIED |
| Нет истории местоположений (REQ-PRIV-001) | да | да | smoke | ✅ VERIFIED |
| Privacy Policy / Terms (REQ-PRIV-005) | да | нет | — | 🔴 NOT IMPLEMENTED |
| Офлайн-оболочка (REQ-OFF-001) | да | да | да | 🟢 IMPLEMENTED (B-12) |
| WCAG 2.1 AA (REQ-A11Y-001) | да | да | ручной axe (раунд 5) | 🟢 IMPLEMENTED |
| CI (REQ-CI-001) | да | да | — | ❓ UNKNOWN (запуски не проверены) |
| Наблюдаемость (REQ-OBS-002) | да | нет | — | 🔴 NOT IMPLEMENTED |
| Собственный роутер (REQ-ROUTE-002) | да | нет | — | 🔴 NOT IMPLEMENTED |
| Native / CarPlay / Android Auto (REQ-PLAT-002…005) | да | нет | — | 🔴 NOT IMPLEMENTED |

---

## 19. ИТОГОВЫЙ ОТЧЁТ

### Current Project State
navWeather — зрелое web-приложение (React + MapLibre + Cloudflare Worker), в котором **ядро продукта реально
работает**: маршрут по дорогам, ETA по рёбрам, адаптивная выборка точек, прогноз на время прибытия в каждую точку в её
часовом поясе, сравнение дорог по погоде, лучшее время выезда и своевременные, неспамящие голосовые предупреждения
(проверено на живых провайдерах и в симуляции). Long Trip Mode построен как отдельный чистый модуль и Worker-эндпоинт,
правильно отличает длинную поездку и показывает честные рекомендации (без выдуманной доступности, цен, ожидания на
границе), но **его динамическая часть содержит дефекты** (топливо после перепланирования, стоянки как опоздание,
ночной выезд, устаревшие риски). Эксплуатационная готовность низкая: бесплатные некоммерческие провайдеры без SLA
(Overpass отказал в живом прогоне), лимит Open-Meteo free при ~30 DAU, нет логов, политики конфиденциальности,
реальных устройств, факт деплоя и CI не подтверждён. **Проект не production-ready.**

### Implemented (действительно работает)
Маршрутизация с альтернативами и via-пробами; ETA по рёбрам; адаптивная выборка; батч/кэш/устаревание прогнозов;
сопоставление прогноза с ETA и часовыми поясами; дорожная полоса погоды, «по пути», точки на карте; лучшее время
выезда; алерты с латчингом, окнами по серьёзности и анти-спамом; навигация с голосом, полосами, ограничениями
скорости, камерами, кривыми; отклонение и пересчёт, переход на известную дорогу; погодный объезд; режимы транспорта;
live-шаринг; сообщения водителей; приблизительный старт; классификация поездки; план Long Trip с границами и отелями
OSM; PWA-оболочка; en/ru; доступность; версия API; строгая безопасность Worker.

### Partially Implemented
Мультиостановки (без перестановки и стоянок); модель ETA (без трафика, погоды, темпа водителя); грозы (без
молний); зарядка EV; места отдыха; голосовой поиск POI; онбординг; абстракции GPS; погодный слой (без радара);
состояния карты; пороги (тестируемы, но не задокументированы полностью); таймлайн (пересчёт только за рулём).

### Broken
B-01 топливо после перепланирования (**P0**); B-02 напоминание о заправке «уезжает» (**P0**); B-03 стоянка = опоздание;
B-04 ночной выезд; B-05 план до загрузки посёлков; B-06 горизонт прогноза; B-07 устаревшие риски; B-08/B-09
расхождение порогов и сдвиг часа; B-10 троттлинг `derive`; B-16 уязвимость dev-зависимости; соблюдение условий
Transitous и Open-Meteo free (LIC-02, LIC-03).

### Missing
Собственный роутер / геокодер / POI; edge-кэш погоды; официальные предупреждения; экстремальные температуры;
фоновые уведомления; avoid-опции, кратчайший маршрут, перекрытия; truck-ограничения; реальная доступность отелей,
цены топлива, ожидание на границе (нет источников — корректно); native / CarPlay / Android Auto; аккаунты;
Privacy Policy / Terms; наблюдаемость; staging/preview; Playwright E2E; тесты на устройствах; ESLint; runbooks;
грузинский UI (решение владельца).

### Technical Debt
`store.ts` 2,001 строка; пороги в 7 файлах; модульные синглтоны состояния; основной чанк 604 KB; неограниченная карта
прогнозов; веерные запросы отчётов; единый DO `Reports`; 14 переменных Open-Meteo; Overpass в реальном времени на
каждый маршрут; dev-зависимость с уязвимостью; нет линтера.

### Security Issues
B-16 (dev high) · нет ESLint/SAST · нет WAF/Turnstile · нет модерации отчётов · `/whereami` без rate limit · ключ
шаринга в `localStorage` · нет HSTS в `_headers` · B-17 (суточная соль) · preview делит prod-DO · наблюдаемость
выключена (инциденты не видны). Критических уязвимостей в production-коде не найдено.

### UX Issues
Неправдоподобный план ночного выезда; ночёвки без названий в первом плане; «нет прогноза» на дальних участках
многодневной поездки; ложные «прибытие сдвинулось»; напоминание о заправке не приближается; не объяснены ограничения
web-навигации; маленькие цели (маркеры, атрибуция); ошибки тайлов не видны; голос не понимает «через 100 км» и
«добавь остановку».

### Performance Issues
Основной чанк 604 KB / 196 KB gzip; CWV не измерялись; `derive` на каждый GPS-фикс (B-10); `stableJson` сериализует
сравнения дорог на каждом `derive`; неограниченный кэш прогнозов в store; Overpass 8–12 с задерживает названия.

### Product Gaps
Фоновые уведомления (главная ценность — предупредить заранее — работает только при открытом экране); официальные
предупреждения; экстремальные температуры; учёт ночного вождения и усталости; учёт израсходованного топлива;
время стоянки на пользовательских остановках; сохранённые поездки; трафик.

### Documentation Gaps
Нет `docs/runbooks/`; нет `/plan.md` (есть `docs/PLAN.md`); статусы VERIFIED у требований с дефектами (исправлено в
этом аудите); полной таблицы порогов в `WEATHER_ENGINE.md` нет; устаревшее вступление `ARCHITECTURE.md`; число тестов
(исправлено); не задокументировано поведение при ночном выезде и границы горизонта прогноза.

---

## 20. EXECUTIVE SUMMARY

```
PROJECT STATUS:
██████▌░░░ 65%   (по приоритетам; без весов — 55%)

Requirements audited: 173
Verified ✅:     50
Implemented 🟢:  34
Partial 🟡:      27
Missing 🔴:      45
Broken ⚠️:       12
Unknown ❓:      5

Critical (P0):  48   (из них открыто: 3)
High (P1):      46   (открыто: 23)
Medium (P2):    53   (открыто: 38)
Low (P3):       26   (открыто: 25)
```

**Готовность по областям** (та же формула, внутри области):

| Область | Строк | % | Область | Строк | % |
| --- | --- | --- | --- | --- | --- |
| Ядро CORE | 13 | 96 | Голос VO | 8 | 63 |
| Функции FEAT | 6 | 79 | UX | 6 | 80 |
| Карта MAP | 10 | 64 | Mobile MOB | 8 | 56 |
| Маршрутизация RT | 11 | 61 | Производительность PF | 6 | 54 |
| Погода WX | 13 | 60 | Cloudflare CF | 10 | 55 |
| Риски RISK | 7 | 65 | Данные DB | 3 | 69 |
| Предупреждения AL | 5 | 81 | Безопасность SEC | 9 | 65 |
| Long Trip LT | 19 | 55 | Приватность PRV | 6 | 73 |
| Мультиостановки MS | 4 | 52 | Лицензии LIC | 6 | 42 |
| ТС / Truck VH | 3 | 25 | Тесты TST | 7 | 44 |
| Граница BD | 2 | 67 | Документация DOC | 4 | 29 |
| Таймлайн TL | 2 | 65 | i18n / офлайн / a11y | 5 | 75 |

**Методика.** Каждая строка MASTER TABLE (§3) — одно требование. Баллы статусов: ✅ 1.0 · 🟢 0.8 · 🟡 0.5 ·
⚠️ 0.25 · ❓ 0.25 · 🔴 0. Вес строки по приоритету: P0 = 4, P1 = 3, P2 = 2, P3 = 1. Процент = Σ(балл × вес) / Σ(вес).
«Открыто» — строки со статусом, отличным от ✅/🟢. Будущие фазы (native, CarPlay, truck) входят с низким весом, поэтому
процент отражает готовность к **заявленному объёму требований**, а не только к web-MVP. Процент не означает
production-ready: открыты P0-дефекты и эксплуатационные блокеры. Вердикт: **NOT VERIFIED для production**;
ядро продукта — **PARTIALLY VERIFIED** (✅ для поездок до ~2 суток).

### 10 самых важных проблем

| # | Проблема | Приоритет | Где |
| --- | --- | --- | --- |
| 1 | Остаток топлива не учитывается при перепланировании → совет заправиться после того, как топливо кончится (B-01) | P0 | `src/state/trip.ts`, `src/trip/replanning/progress.ts`, `src/trip/planning/planner.ts` |
| 2 | Обычное напоминание о заправке не приближается во время езды (B-02) | P0 | `src/intelligence/routeIntelligence.ts` |
| 3 | Запланированная стоянка считается опозданием → ложные перепланирования и уведомления (B-03) | P1 | `src/trip/replanning/progress.ts`, `src/state/trip.ts` |
| 4 | Ночной выезд: дневные «ночёвки», вторая ночёвка через 3.6 ч, 1 приём пищи за 41 ч (B-04) | P1 | `src/trip/planning/schedule.ts` |
| 5 | Многодневные поездки: прогноз только на 48 ч, риски поездки не обновляются (B-06, B-07) | P1 | `src/state/store.ts`, `src/state/trip.ts` |
| 6 | Первый план без городов ночёвки и альтернатив (B-05) | P1 | `src/state/trip.ts`, `src/services/routePlanner.ts` |
| 7 | Пороги опасностей расходятся в 7 файлах; часовой сдвиг кодов поездки (B-08, B-09) | P1 | `src/trip/weather/hazards.ts`, `src/intelligence/weatherAlerts.ts`, `src/services/trip/requests.ts` |
| 8 | Условия провайдеров: Open-Meteo free превышается при ~30 DAU; Transitous требует open source; публичные OSRM/Overpass некоммерческие и без SLA (Overpass отказал вживую) | P1 | `OpenMeteoProvider.ts`, `TransitousProvider.ts`, ADR-004/005 |
| 9 | Нет наблюдаемости, Privacy Policy / Terms, staging; деплой и CI не подтверждены | P1 | `wrangler.toml`, `.github/workflows/*` |
| 10 | Нет фоновых уведомлений и тестов на реальных устройствах — главная ценность работает только при открытом экране | P1 / P2 | — |

### 10 следующих действий

| # | Действие | Файлы / модули | Критерий готовности |
| --- | --- | --- | --- |
| 1 | Учитывать израсходованный запас: `rangeKm = запас на старте − пройдено с последней заправки` в `progressStateFor` и при переносе через перестроение; регрессионный тест | `src/state/trip.ts`, `src/trip/replanning/progress.ts`, `src/trip/trip.test.ts` | E9c даёт заправку ≤ 300 + 0.75 × 200 км |
| 2 | Напоминание о заправке привязать к точке старта навигации (запас − пройдено), а не к текущему положению; тест с `progressM > 0` | `src/intelligence/routeIntelligence.ts`, `routeIntelligence.test.ts` | точка неподвижна во время езды |
| 3 | Опоздание = 0, пока машина стоит у запланированной остановки до `departMs`; тест | `src/trip/replanning/progress.ts`, `src/state/trip.ts` | E9a → 0 |
| 4 | Ночной выезд: ночёвка только вечером/ночью по местному времени, ужин «съеден» только для вечерней ночёвки, предупреждение о вождении 00–06; тесты 00:00 / 03:00 / 23:00 | `src/trip/planning/schedule.ts`, `src/trip/config.ts` | ≥1 приём пищи на каждые ~6 ч бодрствования; нет ночёвок 06–17 |
| 5 | Горизонт прогноза: `latestArrival` с учётом плана остановок (или ≥ дистанция/скорость × коэффициент); перезапрос плана при расширении прогноза и при приходе посёлков | `src/state/store.ts` (`loadWeather`), `src/state/trip.ts` (`initTrip`) | E7: 0/145 без прогноза после первой загрузки; риски на все дни |
| 6 | Единый модуль порогов `src/algorithms/weatherThresholds.ts` (или `src/intelligence/thresholds.ts`) + таблица в `WEATHER_ENGINE.md`; исправить сдвиг часа в `weatherSamples` | `weatherAlerts.ts`, `hazards.ts`, `derive.ts`, `departurePlanner.ts`, `roadHazards.ts`, `WeatherStrip.tsx`, `requests.ts` | одинаковые результаты E9b |
| 7 | Исправить троттлинг `derive` (`lastDeriveSimMs` только в симуляции) и ограничить карту прогнозов | `src/state/store.ts` | ≤1 `derive`/с в навигации |
| 8 | Решения владельца + соответствие: Transitous (open source или отключить), контакт Overpass в User-Agent, Open-Meteo (вопрос о лимите, план), камеры по умолчанию | `wrangler.toml`, `src/config.ts`, `docs/legal/*` | записано в PROJECT_REQUIREMENTS §37 |
| 9 | Эксплуатация: `[env.preview]`, Workers Logs без координат, uptime на `/api/v1/health`, подтвердить CI и деплой, обновить `wrangler`, добавить ESLint, `docs/runbooks/` | `wrangler.toml`, `.github/workflows/*`, `package.json`, `docs/runbooks/*` | зелёный CI, работающий preview, алерт uptime |
| 10 | Edge-кэш погоды `/api/v1/weather/points` (ячейка + прогон модели, ≤10 переменных) до бета-теста с >25 DAU | `worker/weather.ts` (новый), `src/services/weather/*`, ADR-005 | число вызовов Open-Meteo не растёт линейно с пользователями |
