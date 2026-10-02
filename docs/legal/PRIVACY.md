# Privacy architecture and compliance checklist

> **Not legal advice.** This is an engineering checklist. Items marked
> **LEGAL REVIEW** need a qualified lawyer for each launch country before
> public release.

## 1. Data inventory (current)

| Data | Collected? | Where it goes | Retention | Basis (to confirm) |
| --- | --- | --- | --- | --- |
| Precise position (GPS) | on device, when the user locates, navigates or shares | stays on device, except: live share (Worker DO, latest only), a report's position, and coordinates inside provider requests | share: until stop/expiry; report: ≤12 h (×3 if confirmed) | user request (contract) / consent prompt by the OS |
| Route start/end/geometry | on device | sent to the router (OSRM/FOSSGIS/Transitous) and, as sample points, to Open-Meteo; places along it to Overpass | not stored by us; providers' own policies apply | user request |
| Searched text | on device | Photon (autocomplete), Nominatim (submit) | not stored by us | user request |
| Approximate location from IP | only when the device gives none | computed by our Worker from Cloudflare metadata | not stored | legitimate interest — **LEGAL REVIEW** |
| IP address | every request (transport) | Cloudflare; reports DO keeps only a daily-salted hash | hash rotates daily, rows expire with reports | legitimate interest (abuse prevention) |
| Voice | only during push-to-talk | browser vendor's speech service (Chrome) | vendor policy | consent (user presses the mic; disclosed in Settings) |
| TTS text | when guidance speaks | Google voices in Chrome are online (text to Google) | vendor policy | disclosed in Settings |
| Preferences, saved places, recents | on device | nowhere | user-controlled; recents can be off/cleared | — |

No cookies, no analytics, no advertising identifiers, no accounts today.

## 2. Principles (requirements)
- **Minimum collection:** the server never needs a whole trip (ADR-003).
- **No location history** server-side (REQ-PRIV-001). On device, only an
  opt-out "recent destinations" list and a resumable-drive pointer (30 min).
- **Route history: OFF by default, opt-in only.** Reasoning: location history
  is highly sensitive (it reveals home, work, health visits), the core feature
  doesn't need it, and an opt-in can always be added later while a default-on
  can't be taken back from data already collected. If ever built: device-first,
  per-trip delete, delete-all, export, and an explicit retention period.
- **Background tracking:** none on the web (impossible). Native: only during
  active navigation or an active live share the user started, with a visible
  indicator and one-tap stop; never passive tracking (Google Play policy
  forbids it for background location anyway).
- **Logs:** no coordinates, bboxes, search text or tokens in logs/analytics (REQ-PRIV-004).
- **Third parties:** each provider receives only the coordinates/text its
  request needs; listed in the Privacy Policy with links to their policies.

## 3. Account data (planned, ADR-008)
Email (or passkey only), optional display name, synced settings and saved
places. Deletion in-app and via a web page, immediate hard delete.

## 4. Compliance checklist

### GDPR (EU users) — Regulation (EU) 2016/679
- [ ] Controller identity and contact in the Privacy Policy (Art. 13).
- [ ] Lawful basis per processing purpose (table above) — **LEGAL REVIEW**.
- [ ] Data subject rights: access, rectification, erasure, portability,
      objection — trivial without accounts; with accounts: export + delete endpoints.
- [ ] Records of processing (Art. 30) — short register in `docs/legal/`.
- [ ] Processor agreements: Cloudflare (DPA), email provider (if any);
      public APIs (Open-Meteo, OSM services, Transitous) receive coordinates —
      assess whether they act as independent controllers — **LEGAL REVIEW**.
- [ ] International transfers (Cloudflare global network; providers in
      Germany/Switzerland/EU) — **LEGAL REVIEW**.
- [ ] DPIA consideration: precise location in a navigation app is high-risk
      processing; document a DPIA before accounts or background tracking —
      **LEGAL REVIEW**.
- [ ] Breach procedure (72 h notification) — SECURITY §7.

### ePrivacy / cookies
- Device storage used today (localStorage, sessionStorage, service-worker
  cache) is for functions the user asked for → generally "strictly necessary";
  no consent banner while no analytics/ads/trackers exist — **LEGAL REVIEW**
  per country. Any analytics must be cookieless and aggregate, or consent-gated.

### Georgia — Law of Georgia on Personal Data Protection (adopted 14 June 2023, most provisions in force 1 March 2024; supervisor: Personal Data Protection Service)
- [ ] Map obligations (notices, DPO thresholds, impact assessments from
      June 2024) to this app — **LEGAL REVIEW** (source:
      [matsne.gov.ge](https://matsne.gov.ge/en/document/view/5827307); verified as existing 2026-10-02, obligations not analysed).

### California (only if targeting US users)
- [ ] CCPA/CPRA applicability thresholds — **REQUIRES VERIFICATION** (official
      site unreachable on 2026-10-02). Precise geolocation is "sensitive
      personal information" under CPRA — confirm.

### Apple App Store (Phase 4)
- [ ] Privacy nutrition labels (location: "precise", linked? no; tracking: no).
- [ ] `PrivacyInfo.xcprivacy` manifest (collected data types, required-reason
      APIs) — details **REQUIRE VERIFICATION** at implementation time.
- [ ] Purpose strings: `NSLocationWhenInUseUsageDescription`, and
      `NSLocationAlwaysAndWhenInUseUsageDescription` only if background is
      requested; `UIBackgroundModes: location` for navigation (2.5.4 allows
      "location" for its intended purpose).
- [ ] 5.1.5: notify and get consent before collecting/transmitting location.
- [ ] 5.1.1(v): in-app account deletion if accounts exist.

### Google Play (Phase 5)
- [ ] Data safety form: precise vs approximate location (≥3 km² = approximate),
      collected/shared, encryption in transit, deletion; ephemeral processing
      may be declared as such.
- [ ] Background location: only if core (turn-by-turn qualifies; passive
      tracking does not), prominent in-app disclosure before the permission
      prompt, Permissions Declaration Form + ≤30 s video.
- [ ] Foreground service type `location` (`FOREGROUND_SERVICE_LOCATION`),
      declared in Play Console (target Android 14+).
- [ ] Account deletion: in-app path + web link.

## 5. Documents to publish (before public beta)
| Document | Content | Review |
| --- | --- | --- |
| Privacy Policy | inventory above, providers, retention, rights, contact | LEGAL REVIEW |
| Terms of Service | weather and routes are forecasts/estimates; driver responsibility; reports are user content; speed-camera legality; no warranty | LEGAL REVIEW |
| Cookie / storage notice | what is stored on the device and why | LEGAL REVIEW |
| Data processing register | Art. 30 record | LEGAL REVIEW |
| Data deletion page | how to delete local data / account; web form for accounts | required by Google Play with accounts |
| Attribution page | all data licences (LICENSING_MATRIX) | engineering |
