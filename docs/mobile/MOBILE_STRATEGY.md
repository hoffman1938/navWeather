# Mobile, CarPlay and Android Auto strategy

> **Update 2026-10-04:** the PWA row "Offline map regions — impractical" is being re-evaluated: DEVELOPMENT_PLAN DP-9.8
> plans user-initiated region downloads (PMTiles + places) and starts with ADR-018, which may amend ADR-012. Store apps
> stay blocked by fees (ADR-014/015).

There are no native apps yet. This document prepares them so the backend and
the core don't need a rewrite. Stack decision: [ADR-010](../architecture/decisions/ADR-010-mobile-stack.md)
(Proposed — decided by a spike). Platform facts verified 2026-10-02 (Apple App
Store Review Guidelines, Apple CarPlay page, Apple account-deletion page,
Android Car App Library docs, Google Play policy pages); Apple pages that
didn't render are marked **REQUIRES VERIFICATION**.

## 1. What the web can and cannot do (PWA reality)

| Capability | Android Chrome (PWA) | iOS Safari (home-screen web app) |
| --- | --- | --- |
| Install, offline shell | yes | yes |
| Foreground GPS navigation, screen kept on (Wake Lock) | yes | yes (Wake Lock in recent Safari) |
| Navigation with screen locked / app in background | **no** | **no** |
| Push notifications | yes | home-screen web apps only (WebKit, iOS 16.4+) — re-verify |
| CarPlay / Android Auto | **no** | **no** |
| Background location sharing | **no** | **no** |
| Offline map regions | impractical (storage quotas, eviction) | impractical |

Conclusion: the PWA is a strong planning tool and an acceptable foreground
navigator; real in-car use needs native apps.

## 2. What is shared across Web / iOS / Android

| Layer | Share? | How |
| --- | --- | --- |
| API types and contract | yes | `src/api/v1.ts`, protocol files → `packages/api-client` |
| Route, weather, navigation models (`src/types`) | yes | `packages/core` |
| Engines: timing, sampling, weather matching, grouping, alert engines, deviation, guidance, voice phrasing | yes (the main asset) | `packages/core`, run in Hermes (RN) or an embedded JS engine; or ported if ADR-010 chooses full native |
| Validation (protocol sanitizers) | yes | shared with the Worker already |
| i18n messages (en, ru, ka) | yes | `packages/i18n` (spoken + display forms) |
| Analytics abstraction | yes | counts-only event names |
| UI | no | web React DOM; native/RN screens designed for each platform |
| Map rendering | partly | same style JSON; MapLibre GL JS / MapLibre Native |
| GPS, background, TTS, notifications, car screens | no | native modules per platform |

Repository split happens only when the mobile work starts (ROADMAP §Repository structure).

## 3. iOS

| Item | Class | Notes |
| --- | --- | --- |
| Apple Developer Program membership | REQUIRED | — |
| Location purpose strings (`NSLocationWhenInUseUsageDescription`; "Always" only if needed) | REQUIRED | navigation needs When-In-Use + background mode, not Always |
| `UIBackgroundModes: location` for active navigation | REQUIRED | 2.5.4: background services only "for their intended purposes" — location is one |
| 5.1.5 location consent before collecting/transmitting | REQUIRED | system prompt + our explanation screen (exists on web: location primer) |
| Privacy manifest `PrivacyInfo.xcprivacy` + App Store privacy labels | REQUIRED | details **REQUIRE VERIFICATION** at build time |
| 4.2 minimum functionality (not a repackaged website) | REQUIRED | native navigation, CarPlay, offline justify it |
| Account deletion in-app (5.1.1(v)) | REQUIRED if accounts | delete "the entire account record, along with associated personal data"; may take time if the user is told |
| Sign in with Apple | OPTIONAL | only required if a third-party login (Google…) is offered (4.8); our own passkey/email system is exempt |
| Push notifications (APNs) | OPTIONAL | departure reminders ("rain on your usual route") — opt-in |
| Live Activities / widgets | FUTURE | ETA + next weather on Lock Screen; also shown in CarPlay |
| CarPlay navigation entitlement | FUTURE | §5 |
| Default navigation app (EU, iOS 18.4+) | FUTURE | user setting reported by press; developer requirements **REQUIRE VERIFICATION** |

## 4. Android

| Item | Class | Notes |
| --- | --- | --- |
| Play Console account, Data safety form | REQUIRED | precise vs approximate location (≥3 km² = approximate) |
| `ACCESS_FINE_LOCATION` + foreground service type `location` (`FOREGROUND_SERVICE_LOCATION`, target 14+) | REQUIRED | declare FGS type in Play Console (Policy → App content); FGS can't start from background without background permission |
| Background location (`ACCESS_BACKGROUND_LOCATION`) | OPTIONAL — avoid | foreground service during navigation is enough; if requested: prominent disclosure, declaration form, ≤30 s video; turn-by-turn qualifies, passive tracking does not |
| Notification permission (Android 13+) | REQUIRED for the navigation FGS notification | — |
| Account deletion in-app + web link | REQUIRED if accounts | — |
| TextToSpeech, audio focus ducking | REQUIRED | voice adapter |
| Android Auto | FUTURE | §6 |

## 5. CarPlay (future, Phase 6)
- **Entitlement:** navigation apps must request the CarPlay entitlement from
  Apple ("Request CarPlay app entitlement… contact form"); approval is not
  guaranteed. Navigation apps can show guidance in the instrument cluster/HUD
  on supported cars.
- **UI:** CarPlay framework templates — the map is drawn by the app into the
  CarPlay window base view; trip previews, maneuvers and alerts use Apple's
  templates (`CPMapTemplate`, navigation session APIs). No arbitrary UI;
  limited list depth/text while driving. Exact template rules: Apple's CarPlay
  Developer Guide — **REQUIRES VERIFICATION** at design time.
- **Map rendering:** MapLibre Native rendering into the CarPlay window.
- **Voice:** AVSpeechSynthesizer via the shared instruction IDs; audio session
  ducks other audio.
- **Background:** CarPlay navigation runs with the phone locked using the
  location background mode.
- **Weather in CarPlay:** one alert at a time as a maneuver-style banner;
  route-weather timeline only in trip preview (never while moving).
- Normal iOS UI code does **not** become CarPlay automatically.

## 6. Android Auto (future, Phase 7)
- Car App Library; `CarAppService` with category
  `androidx.car.app.category.NAVIGATION`; permission
  `androidx.car.app.NAVIGATION_TEMPLATES` (navigation apps only).
- Templates: `NavigationTemplate` (active guidance + travel estimates),
  `MapWithContentTemplate`; the app draws the map on the provided surface.
- `NavigationManager.navigationStarted() / updateTrip() / navigationEnded()`
  so the host can manage multiple navigation apps and cluster data.
- Must meet the car app quality guidelines (driver distraction limits).
- Same weather-alert rule as CarPlay: one banner, voice first.

## 7. Offline (native)
Downloadable regional PMTiles (same builds as the web fallback), on-device
Valhalla tiles for re-routing, cached forecasts for the planned trip (stale
labels). Never promise offline forecasts.

## 8. API readiness checklist for mobile
- [x] Versioned `/api/v1`, additive-only changes (ADR-009).
- [x] JSON errors, no cookie dependence for anonymous endpoints.
- [ ] Bearer-token auth + refresh rotation (ADR-008).
- [ ] Minimum-supported-client check (`GET /api/v1/health` can return
      `minClient` per platform — additive).
- [ ] Generated OpenAPI file for native clients.
