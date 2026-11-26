# MedSync mobile app — plan

Decided with the owner on 2026-11-26: **final goal is a mobile app; iPhone and Android from the start; online only (no offline mode); records the whole doctor–patient conversation.** Fictional data only until the legal and security gates in `SECURITY_PLAN.md` are met. Nothing in this document has been built yet.

## 1. Approach: one codebase, web first, wrapped for phones

Recommended: keep the existing React + TypeScript web app as the single codebase and package it for iOS and Android with **Capacitor** (a wrapper that puts the web app inside a native shell and adds native features such as the microphone permission, secure storage and biometric unlock).

Why this and not a rewrite in React Native or two native apps:
- Everything built so far is reused: login screens, review UI, sign rules, source highlighting, speech capture, history.
- One team can ship both platforms, and the web version stays usable for testing in a browser.
- If a native feature later proves too limited (for example reliable background audio), only that part moves to a native plugin or a React Native rewrite.

Trade-off: a wrapped web app feels slightly less native than a fully native one. For a form-and-review workflow this is acceptable.

## 2. Things that change because it is a phone

### 2.1 Login must not use cookies
Today the session is an `HttpOnly; SameSite=Strict` cookie. In a wrapped app the page origin is `capacitor://localhost` (iOS) or `https://localhost` (Android), and the API is on another host, so a strict cookie will not be sent. Plan: for the mobile client the server issues a **short-lived access token** (kept in the iOS Keychain / Android Keystore through a secure-storage plugin, never in web storage) and the app sends it in an `Authorization` header. The cookie flow stays for the browser version. Server changes: token issue and refresh, revocation, the same idle (shorter on mobile: 5 minutes) and absolute limits, CORS and Origin allow-list for the app origins, tests for all of it.

### 2.2 HTTPS is mandatory
Phones only allow the microphone on secure origins, and iOS blocks plain-http API calls by default. So the clinic server needs a real TLS certificate (a public one, or an internal certificate authority installed on the phones through device management). The speech-service rule that LAN addresses must be https already points the same way. Certificate pinning can be added later.

### 2.3 Audio capture on iOS
Safari and the iOS web view ignore the requested 16 kHz sample rate, so the current capture (`src/audio/capture.ts`) throws there. Fix: capture at the device rate and resample to 16 kHz inside the audio worklet. Also handle: audio interruptions (a phone call), the app going to the background (iOS stops the microphone), and keeping the screen awake during a visit.

### 2.4 Layout
The app was built for a desktop window (two columns, wide tables). It needs a phone layout: single column, large touch targets, the transcript and the document as tabs or a bottom sheet, readable at arm's length.

### 2.5 Building for iOS needs a Mac
An iOS app can only be compiled with Apple's Xcode on macOS. This PC runs Windows. Options: a Mac (or a colleague's), or a cloud macOS builder (GitHub Actions macOS runners, Codemagic, or similar). Android can be built on Windows with Android Studio. **Open question for the owner: is a Mac available?**

### 2.6 Distribution
- Android: direct install or an internal testing track while testing; managed devices for clinics.
- iPhone: TestFlight for testing, Apple Business Manager "custom apps" or the App Store for rollout.
- Developer accounts (Apple, Google) are created and paid for by the owner. App-store rules for health apps and the legal status of medical software need the lawyer (new questions added to `docs/LEGAL_QUESTIONS_RU.md` when this is agreed).

## 3. Mobile security requirements (added to the security plan)
- Session tokens only in Keychain / Keystore; nothing sensitive in web storage, logs or crash reports.
- App lock on open and after a short idle time, with biometrics or a PIN; remote revocation of a lost phone's sessions.
- Block screenshots and hide content in the app switcher on screens showing patient data.
- Audio never written to storage; recording only while the screen is on and visible, with a clear on-screen recording indicator.
- Exclude app data from phone backups (iCloud / Google backup).
- Root or jailbreak detection as a warning at least; app signing and integrity checks.
- No patient data in notifications; no clipboard export of transcripts on phones.
- Deep links and file sharing disabled unless needed.
- Lost-or-stolen-phone procedure written down; device management (MDM) recommended for clinics.
- Recording the whole conversation records the **patient's voice**: consent wording and retention are legal questions 3 and 5 and must be answered before real use.

## 4. Speech with whole-conversation recording
This is the hardest speech task, and the current numbers are not good enough (see `docs/ASR_DESIGN.md` section 9). On a phone the microphone is also farther from the speakers and the room noisier. Consequences for the plan:
- The phone sends audio to a shared server; no strong hardware on the phone (see the earlier answer on thin clients).
- The larger-model test in `docs/GPU_TEST_PLAN.md` becomes more important, with test recordings made **on phones**.
- Keep the safety aids: yellow low-confidence words, underlined numbers, one-click drug suggestions, mandatory review.
- Add a **formulary drug picker** next to the transcript so that drugs and doses are confirmed by tapping, not trusted from speech. Recommended whatever the model's accuracy turns out to be.
- Speaker labels: today they are manual. On a phone this is awkward; options are two phones/microphones, or a diarization model on the server (to be tested).

## 4a. What can be reused as it is
Server: `server/` (auth, roles, audit, sign rules, `/api/asr`, `/api/extract`). Shared logic: `src/domain`, `src/audio`, `src/data`. Web UI: pages need a responsive pass, not a rewrite.

## 5. Work packages, in order

| # | Package | Where it can be done | Depends on |
|---|---|---|---|
| 1 | Responsive phone layout for all screens | this PC, checked in the browser at phone width | nothing |
| 2 | Token auth for native clients (server + client), tests | this PC | nothing |
| 3 | Capture fix for iOS (resample in worklet, interruptions, wake lock) | this PC, final check on a real iPhone | nothing |
| 4 | Installable web version (PWA) for early phone tests, no store | this PC + a phone on the same network over https | 1, 3, HTTPS |
| 5 | Capacitor project, Android build, secure storage, app lock, screenshot block | this PC with Android Studio (large install, needs the owner's OK) | 1 to 3 |
| 6 | iOS build and TestFlight | a Mac or a cloud macOS builder; Apple developer account | 5 |
| 7 | Mobile security review and tests; update the tracker | this PC, then an external reviewer | 5, 6 |
| 8 | Phone speech test set: recordings made on phones in clinic-like rooms | the owner and colleagues | `docs/GPU_TEST_PLAN.md` |

Packages 1 to 3 are useful whichever packaging is finally chosen, so they can start immediately.

## 6. Decisions still needed
1. Mac available, or use a cloud macOS builder? (decides package 6)
2. OK to install Android Studio and the Android SDK for package 5? (large download from Google; I will state file, source and size first)
3. How phones will reach the server (clinic Wi-Fi only, VPN, or internet) and who issues the TLS certificate.
4. Confirm Capacitor as the packaging (this plan's recommendation).
