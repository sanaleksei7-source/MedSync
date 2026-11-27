# MedSync mobile app — step-by-step development plan

Goal (set 2026-11-26): an **iPhone and Android app**, online only, that records the doctor–patient conversation, drafts the medical document, lets the doctor review, sign and send it. Fictional data only until the release gates in `SECURITY_PLAN.md` section 5 are met.

Related documents: `SECURITY_PLAN.md` (security phases and progress tracker), `docs/MOBILE_PLAN.md` (mobile design), `docs/ASR_DESIGN.md` and `docs/GPU_TEST_PLAN.md` (speech), `docs/PHASE1_ARCHITECTURE.md` (server design and decisions D1–D7), `docs/LEGAL_QUESTIONS_RU.md` (questions for the lawyer and Минздрав).

Who does what: **Claude** = I build and test it; **Owner** = you decide, record, buy, sign up or install; **Ext** = an outside party (lawyer, Минздрав, security firm, clinic IT).

Estimates are rough working time, not calendar time, and assume the owner answers within a day or two. Legal answers and outside reviews are the long poles.

## Where we are today

Built and tested on fictional data: login with a second factor, roles and patient assignment, server-side sign rules, hash-chained audit log, speech path to a local server, editable transcript with confidence highlights and drug suggestions, document types, history, security scans. **Not yet:** a phone layout, native apps, a real database, real ЭЦП, Тундук, a model good enough on drug names, server-held drafts, independent review.

---

## Progress tracker

**Last updated:** 2026-11-27 · **Overall:** Stages 0, 1 and 2 are open at the same time. Stage 1 is built except the real-phone test (waiting on the owner); Stage 2 has the larger-model test done and needs a GPU machine; Stages 3–8 not started.

Legend: ✅ done · 🟡 partly done · ⬜ not started · 🚫 waiting on the owner or an outside party

| Stage | Status | Steps done / total | Notes |
|---|---|---|---|
| 0 — Housekeeping and decisions | 🟡 In progress | 2 / 8 | 4 partly done (0.1 CI result unchecked, 0.4 one question open, 0.5 and 0.7 need the owner), 0.3 and 0.6 waiting on the owner |
| 1 — Phone-ready web app | 🟡 In progress | 1 / 6 | 1.2 done; 1.1, 1.3, 1.4, 1.5 built and checked on this PC, each still needs a real phone; 1.6 (phone test) waits on the owner, checklist in `docs/PHONE_TEST_CHECKLIST.md`. Mobbin references were not used (connector not connected) |
| 2 — Speech quality | 🟡 In progress | 1 / 8 | 2.1 done: bigger model is clearly better (18 % word errors, 4/10 drugs) but too slow on CPU (about 7× real time), so the GPU test (2.3) is now the key question. `docs/ASR_DESIGN.md` sections 9 and 9.1 |
| 3 — Real server foundation | ⬜ Not started | 0 / 7 | Hosting choice depends on a legal answer |
| 4 — Native iPhone and Android apps | ⬜ Not started | 0 / 7 | Needs Stage 1; iPhone needs a Mac or cloud builder |
| 5 — Legal-gated integrations | 🚫 Waiting | 0 / 5 | Needs lawyer, Минздрав and vendor answers |
| 6 — Verification | ⬜ Not started | 0 / 8 | Mostly outside parties |
| 7 — Pilot | ⬜ Not started | 0 / 5 | Only after every release gate |
| 8 — Operate | ⬜ Not started | — | |

Evidence: 0.1 — all tests, the build and the secret scan passed before commit `a09c206`; pushed to GitHub on 2026-11-26 with the owner's approval, and the CI run has not been checked yet. 0.2 (✅) — the 11 project copies were checked byte for byte against the originals in `C:\Users\User\medsync-asr\recordings` and moved to `C:\Users\User\medsync-asr\duplicates-from-project`.

### Changelog
| Date | Change |
|---|---|
| 2026-11-26 | Plan written. Stage 0: pending work committed and pushed; recordings moved out of the project; `.gitignore` bug fixed (the `data/` rule also hid `src/data/`); legal list extended with 7 mobile questions (now 31); drug formulary template created. Owner's answers recorded: no Mac, phones over the internet, keep `dist/` |
| 2026-11-27 | Step 2.1 done: `large-v3-turbo` downloaded with the owner's OK (checksum verified) and tested on the 11 recordings; results in `docs/ASR_DESIGN.md` 9.1 |
| 2026-11-26 | Step 1.6 prepared: phone test checklist written; waiting for the owner to run it |
| 2026-11-26 | Step 1.5 built (installable web version, no data caching); phone check pending |
| 2026-11-26 | Step 1.4 built (HTTPS on the LAN for phone tests); phone check pending |
| 2026-11-26 | Step 1.3 built (iPhone-safe audio capture, resampler with tests); real-device check pending |
| 2026-11-26 | Step 1.2 done on the server: token login for apps (see step row); tokens kept as hashes only, never logged |
| 2026-11-26 | Step 1.1 built: phone layout for all screens (see step row). Build passes; layout checked in the browser pane at 375 px |

How this is maintained: whenever a step moves, its Status cell, the stage counts, the evidence line and the changelog are updated, and `SECURITY_PLAN.md` gets a matching changelog row if the step is security-related.

---

## Stage 0 — Housekeeping and decisions (about 1–2 days)

| # | Step | Who | Done when | Status |
|---|---|---|---|---|
| 0.1 | Commit and push the work done since the last push (speech, recording tools, plans) | Claude, on the owner's go-ahead | GitHub matches the computer; CI is green | 🟡 pushed 2026-11-26 (GitHub matches the computer); CI result not yet checked |
| 0.2 | Move the real voice recordings out of the OneDrive project folder (`docs/recordings/`) | Owner | Folder not inside the project | ✅ 2026-11-26 |
| 0.3 | Turn on branch protection for `main` on GitHub | Owner | Settings → Branches rule exists | 🚫 owner |
| 0.4 | Answer: Mac available? Android Studio OK? How do phones reach the server (clinic Wi-Fi, VPN, internet)? | Owner | Answers recorded in `docs/MOBILE_PLAN.md` | 🟡 answered: no Mac (cloud macOS builder), phones reach the server over the internet (see `docs/MOBILE_PLAN.md` sections 7–8); Android Studio question still open |
| 0.5 | Send `docs/LEGAL_QUESTIONS_RU.md` to a lawyer (add the mobile and app-store questions) | Owner | Lawyer has the list; follow-up date set | 🟡 list ready (31 questions); owner to send |
| 0.6 | Create Apple developer and Google Play developer accounts (can wait until Stage 4) | Owner | Accounts exist | ⬜ |
| 0.7 | Get the clinic's real drug formulary (names, forms, doses) as a spreadsheet | Owner | File available to replace the demo list | 🟡 template ready; owner to supply formulary |
| 0.8 | Clean the project folder: remove unneeded files, fix ignore rules, keep voice data out of the repository | Claude, owner confirms deletions | Only needed files remain; scan rejects audio and secrets | ✅ 2026-11-26 `.gitignore` bug fixed, recordings moved out; owner chose to keep `dist/` |

## Stage 1 — Phone-ready web app (about 1–2 weeks)

Useful whichever packaging we finally use. Can run in parallel with Stages 0 and 2.

| # | Step | Who | Done when | Status |
|---|---|---|---|---|
| 1.1 | Responsive phone layout for every screen (login, home, patients, visit, review, history) | Claude | Looks and works at 375 px wide in the browser; touch targets large enough | 🟡 Built: bottom tab bar, cards instead of tables, 44 px targets, 16 px inputs, safe-area insets, sticky sign button. Checked: no sideways scroll, no button under 40 px (login, all tabs, review screen). Not checked: real phone, live-recording page |
| 1.2 | Token login for apps: server issues short-lived tokens, refresh, revocation, shorter mobile idle time, CORS and Origin rules for app origins; keep cookie login for the browser | Claude | Integration tests pass for both; cookie and token cannot be mixed up | ✅ Server side done: `POST /api/login` with `client:"app"` returns an access token (5 min) and a one-time refresh token (rotating; reuse revokes the whole login); idle 5 min, absolute 8 h; `POST /api/token/refresh`; logout revokes; CORS only for `APP_ORIGINS`; cookie and token sessions cannot be swapped or sent together. 34 + 84 tests pass. The app-side client and secure storage come in Stage 4 |
| 1.3 | Audio capture that works on iPhone: capture at the device rate and resample to 16 kHz in the worklet, handle interruptions and screen wake lock | Claude | Unit tests pass; works in Chrome; real iPhone check pending | 🟡 Built: `src/audio/resample.ts` (streaming sinc resampler, 13 tests: level, frequency, aliasing, chunk-independence), `capture.ts` opens at 16 kHz or the device rate and resamples, resumes a suspended audio context, keeps the screen on (Wake Lock), and reports interruptions (mic taken, system pause); the live page keeps the text so far and asks to restart. Done after the real-phone check in 1.6. Resampling is done in the capture layer on the page, not inside the worklet, so it can be tested in Node. Not tested with a real microphone yet |
| 1.4 | Local HTTPS for development (a locally trusted certificate), so a phone on the same Wi-Fi can open the app and use the microphone | Claude, owner installs the certificate on their phone | Phone opens the app and asks for the microphone | 🟡 Built: `npm run dev:lan` makes a local CA (outside the project, name-constrained to private networks and localhost) and serves the app and API over HTTPS on the LAN address; guide in `docs/PHONE_TEST.md`. Checked on this PC with a Node TLS client: trusted with the CA, rejected without it, API reachable through the proxy, a certificate for a public name is rejected. Waiting on the owner: install the certificate on a phone and open the page |
| 1.5 | Installable web version (PWA) for early phone tests, with no store | Claude | Owner can add it to a phone's home screen and run a fictional visit | 🟡 Built: manifest, 4 generated icons (`scripts/make-icons.ts`), iPhone home-screen tags, a service worker that caches only the "no connection" page (never API data, pages or code), registered only in the production build over HTTPS/localhost. Checked in the browser pane on a preview build: worker active, cache holds only `offline.html`, manifest and icons load. Not checked: install on a real phone, the offline page itself. Install needs the production build: `npm run dev:lan:app` serves it over HTTPS on the LAN (guide: `docs/PHONE_TEST.md`) |
| 1.6 | First phone test session: record the script on both an Android and an iPhone, note problems | Owner, Claude fixes | List of issues closed | 🚫 Waiting on the owner. Checklist with 17 checks and a results table is ready: `docs/PHONE_TEST_CHECKLIST.md` |

## Stage 2 — Speech quality (about 2–4 weeks, in parallel)

Decides whether "record the whole conversation" is viable. The `small` model got drug names right 1 time in 10, so this is the biggest risk.

| # | Step | Who | Done when | Status |
|---|---|---|---|---|
| 2.1 | Download and test `large-v3-turbo` (and optionally `medium`) on this CPU with the 11 recordings (owner's OK needed for each download) | Claude, owner approves | Comparison table in `docs/ASR_DESIGN.md` | ✅ `large-v3-turbo` tested on 2026-11-27 (table in `docs/ASR_DESIGN.md` section 9.1): word error rate 27 % → 18 %, drug names 1/10 → 4/10, numbers 91 % → 95.5 %, but about 7× slower than real time on this CPU. `medium` was not downloaded or tested |
| 2.2 | Record the script again on **phones** in clinic-like rooms, with several speakers, plus silence and noise files; target 30–60 minutes | Owner and colleagues | Recordings collected, kept outside the repository | ⬜ |
| 2.3 | GPU speed test on an NVIDIA machine (own PC, rented GPU for a few hours, or clinic server) | Owner provides the machine, Claude runs | Speed and accuracy numbers recorded | ⬜ |
| 2.4 | Replace the demo drug list with the clinic formulary; improve suggestions (phonetic matching, forms and doses) | Claude | Suggestion coverage re-measured on the recordings | ⬜ |
| 2.5 | Formulary drug picker next to the transcript: drugs and doses are confirmed by tapping, not trusted from speech | Claude | Allergy check uses picked drugs; tested | ⬜ |
| 2.6 | Decide speaker handling: manual buttons, two microphones, or server-side separation (test one) | Claude proposes, owner decides | Decision recorded | ⬜ |
| 2.7 | Set the confidence threshold and the pass bars with practising doctors | Owner with doctors | Bars written in `docs/ASR_DESIGN.md` | ⬜ |
| 2.8 | **Decision point:** if no model meets the bars on whole-conversation audio, switch to doctor dictation plus drug picker | Owner | Written decision | ⬜ |

## Stage 3 — Real server foundation (about 3–5 weeks)

Closes the known limits listed in `docs/PHASE1_ARCHITECTURE.md` section 2. Depends on the hosting decision (legal answer) for the database choice, but the design work can start earlier.

| # | Step | Who | Done when | Status |
|---|---|---|---|---|
| 3.1 | Server holds the transcript, draft and the doctor's decisions; signing uses what the server holds, not what the client sends | Claude | Tests prove the client cannot alter signed text | ⬜ |
| 3.2 | Real database (PostgreSQL), encryption at rest, migrations, backups, restore drill | Claude, Ext for hosting | Restore tested from a backup | ⬜ |
| 3.3 | Patients, history and drafts served from the server with access checks; remove patient data from the web bundle | Claude | No patient data in the app bundle | ⬜ |
| 3.4 | Audit log to write-once storage, retention rules, alerts on unusual access | Claude, Ext for storage | Tamper test passes against external storage | ⬜ |
| 3.5 | Account management: password change and reset, second-factor enrolment, user admin, break-glass access with alerts | Claude | Flows tested; reviewed | ⬜ |
| 3.6 | Transcript edit history (who changed which line when) in the audit log | Claude | Edits visible to the auditor role | ⬜ |
| 3.7 | Internet-facing hardening: public HTTPS and HSTS, reverse proxy or firewall, speech service kept private, alerts on login anomalies, DoS plan (`docs/MOBILE_PLAN.md` section 8) | Claude, Ext for the host | Scanner grade acceptable | ⬜ |

## Stage 4 — Native iPhone and Android apps (about 3–5 weeks)

| # | Step | Who | Done when | Status |
|---|---|---|---|---|
| 4.1 | Add Capacitor; Android build; run on a real phone | Claude; owner approves Android Studio install | App runs on an Android phone | ⬜ |
| 4.2 | Secure storage for tokens (Keychain / Keystore), app lock with biometrics or PIN, idle lock | Claude | Tokens are not in web storage; lock tested | ⬜ |
| 4.3 | Screenshot block, hidden app-switcher preview, exclude data from backups, clipboard off for transcripts | Claude | Checked on both platforms | ⬜ |
| 4.4 | Recording behaviour: clear recording indicator, screen stays on, interruptions handled, no audio written to storage | Claude | Test cases pass | ⬜ |
| 4.5 | iPhone build and TestFlight through a cloud macOS builder (no Mac available), plus an Apple account | Owner creates accounts and approves the builder, Claude configures | Testers can install on iPhone | ⬜ |
| 4.6 | Internal distribution for Android (direct install or Google internal testing) | Claude, owner account | Testers can install on Android | ⬜ |
| 4.7 | Lost-phone procedure: remote session revocation, written steps for the clinic | Claude drafts, Ext reviews | Procedure tested | ⬜ |

## Stage 5 — Integrations that wait for legal answers

Start each only after the matching answer arrives; design notes already exist in `docs/PHASE1_ARCHITECTURE.md`.

| # | Step | Needs | Done when | Status |
|---|---|---|---|---|
| 5.1 | Real ЭЦП behind the existing `Signer` interface, key stays on the doctor's side | Accepted scheme, doctor keys | Signature verifiable by a third party | ⬜ |
| 5.2 | Тундук connection and the medical-record format | Agreement with Минздрав, operator specification | Test document accepted by a test environment | ⬜ |
| 5.3 | Language-model step: de-identify text, then a model inside the jurisdiction or a signed processing agreement | Legal answer, vendor contract | Written approval; de-identification tests pass | ⬜ |
| 5.4 | Consent and privacy notice screens in the app, in Russian (later Kyrgyz), lawyer-approved text | Lawyer | Consent stored and auditable | ⬜ |
| 5.5 | Recording retention: automatic deletion of anything held, per the lawyer's rule | Lawyer | Deletion tested | ⬜ |

## Stage 6 — Verification (about 4–8 weeks, mostly waiting for outsiders)

| # | Step | Who | Done when | Status |
|---|---|---|---|---|
| 6.1 | Add a code scanner (Semgrep) to CI; pin GitHub Actions to commit versions; software bill of materials | Claude | Scanner runs on every push | ⬜ |
| 6.2 | Authorization, replay and token tests for the mobile API; fuzzing of the audio and API endpoints | Claude | Tests pass | ⬜ |
| 6.3 | Language-model attack tests re-run with the real model; extraction test set grown | Claude, needs API key | Results recorded | ⬜ |
| 6.4 | Mobile security review (storage, lock, backups, network, tampering) | Ext | No open critical or high findings | ⬜ |
| 6.5 | Independent penetration test, tested from the internet, of API, apps and infrastructure; fix and retest | Ext | Report with no open critical or high findings | ⬜ |
| 6.6 | Independent code review of authentication, signing, audit and data access | Ext | Report closed | ⬜ |
| 6.7 | Privacy impact assessment signed by the data-protection contact and lawyer | Owner, Ext | Signed | ⬜ |
| 6.8 | Clinical safety review of allergy logic, templates and the whole workflow | Practising doctors, pharmacist | Signed hazard analysis | ⬜ |

## Stage 7 — Pilot in one clinic (about 2–3 months)

| # | Step | Who | Done when | Status |
|---|---|---|---|---|
| 7.1 | Check every gate in `SECURITY_PLAN.md` section 5; written sign-off by the security owner, data-protection contact and Минздрав or its designated body | Owner, Ext | All gates ticked | ⬜ |
| 7.2 | Incident-response plan tested with a drill; monitoring and alerts live | Claude, clinic IT | Drill report | ⬜ |
| 7.3 | Train the pilot doctors; start with the lowest-risk document type and a few doctors | Owner, clinic | Doctors trained | ⬜ |
| 7.4 | Measure: minutes saved per visit, doctor edit rate, unsourced-fact rate, near-miss allergy catches, speech errors found in review | Claude | Weekly report | ⬜ |
| 7.5 | Stop criteria: any confirmed leak, or any unsafe document signed because of a software fault, pauses the pilot | Owner | Criteria agreed in writing | ⬜ |

## Stage 8 — Operate and grow

Vulnerability handling with deadlines, annual and change-triggered penetration tests, quarterly access reviews, key rotation, model and prompt change control with the regression set, staff training, Kyrgyz language, more document types, more clinics.

---

## What can run in parallel

- Stages 1, 2 and the design work of 3 can run together; they need the owner mainly for recordings and decisions.
- The lawyer's answers (Stage 0.5) should be requested immediately because they gate Stage 5 and the hosting choice.
- Stage 4 starts when Stage 1 is done, and iPhone work starts when a Mac or builder is available.

## Biggest risks

1. **Speech accuracy on whole conversations** (drug names). Mitigation: Stage 2, with the dictation fallback at 2.8.
2. **Legal answers arrive late** (data location, ЭЦП, Тундук). Mitigation: send the questions now; build everything that does not depend on them.
3. **iPhone builds need a Mac.** Mitigation: cloud macOS builder.
4. **Home-grown authentication.** Mitigation: independent review in 6.6; consider a national identity service.
5. **Whole-conversation recording captures the patient's voice.** Mitigation: consent and retention rules (5.4, 5.5), nothing stored.

## Rough overall timeline

| Period | Work |
|---|---|
| Weeks 0–2 | Stage 0, Stage 1 start, 2.1–2.2 |
| Weeks 2–8 | Stages 1–3 in parallel; speech decision at 2.8 |
| Weeks 8–14 | Stage 4; Stage 5 as answers arrive |
| Weeks 14–22 | Stage 6, mostly outside parties |
| Weeks 22+ | Stage 7 pilot, only if every gate is met |

These are planning estimates. The real schedule is set by the legal answers, the outside reviews and the speech results.
