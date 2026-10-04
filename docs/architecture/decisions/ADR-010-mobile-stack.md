# ADR-010 — Mobile stack: decide by spike; React Native + native car modules favoured

**Status:** Proposed · **Date:** 2026-10-02

## Context
iOS and Android apps do not exist. They must deliver what the web cannot:
background navigation, CarPlay, Android Auto, offline regions, push. The
product's value is in ~6,200 lines of tested, framework-free TypeScript engines
(route timing, sampling, weather matching, alert engines, navigation,
deviation, voice phrasing in en/ru). Car surfaces are native by definition:
CarPlay uses Apple's CarPlay framework templates (entitlement required);
Android Auto uses the Car App Library (`androidx.car.app.category.NAVIGATION`,
`NavigationTemplate`, `NavigationManager`).

## Options
1. **Native Swift + Kotlin**, engines ported twice (or shared via Kotlin
   Multiplatform, ported once to Kotlin).
2. **React Native** (Hermes) reusing the TS engines directly; MapLibre React
   Native for maps; native modules for CarPlay / Android Auto / background
   location / TTS.
3. **Flutter**, engines ported to Dart.
4. **Native UI + embedded JS runtime** (JavaScriptCore / QuickJS) running only the TS core.
5. **Capacitor/PWA wrapper** — rejected up front: Apple 4.2 ("beyond a
   repackaged website") and no CarPlay/AA or reliable background navigation.

## Proposed decision
Run a **2–3 week spike in Phase 4** with acceptance criteria; prefer
**React Native + native car modules** if it passes, else **native + embedded
JS core (option 4)**, else full native (option 1).

Spike acceptance criteria:
1. Background location during navigation for 60 min with the screen off on
   iOS and Android (foreground service type `location` on Android 14+), battery
   comparable to a native baseline.
2. The TS engines run unchanged in Hermes with ≤20 ms per derive on a mid-range phone.
3. A CarPlay `CPMapTemplate` and an Android Auto `NavigationTemplate` prototype
   driven by the shared navigation state.
4. MapLibre Native rendering of our style at 60 fps while navigating.
5. Voice through AVSpeechSynthesizer / Android TextToSpeech from the same
   instruction IDs the web uses.

## Reason
Re-implementing the engines twice is the largest cost and the largest
correctness risk (alerts and ETA must agree across platforms). React Native
keeps one implementation; the car and background pieces are native in every
option anyway.

## Consequences (if accepted)
- Monorepo packages: `packages/core` (engines, types), `packages/api-client`,
  `packages/i18n`; `apps/web`, `apps/mobile` (MOBILE_STRATEGY §2).
  Do the split only when the mobile app starts.
- Native modules: CarPlay scene, Android Auto CarAppService, location FGS, TTS.

## Alternatives rejected (for now)
- **Flutter:** port everything to Dart; no reuse.
- **Capacitor/PWA wrapper:** App Store 4.2 risk, no car platforms.
