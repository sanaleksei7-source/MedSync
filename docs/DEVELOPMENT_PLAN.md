# MedSync web app for laptops — step-by-step development plan

Goal (set 2026-11-28, replacing the 2026-11-26 mobile-app goal): a **web app that runs in the browser on doctors' laptops**, online only, that records the doctor–patient conversation, drafts the medical document, lets the doctor review, sign and send it. Fictional data only until the release gates in `SECURITY_PLAN.md` section 5 are met.

The phone and native-app work is **paused, not deleted**: what was built stays in the code and is listed under "Paused: phone and native-app work" at the end of the tracker. It can be resumed later.

Related documents: `SECURITY_PLAN.md` (security phases and progress tracker), `docs/ASR_DESIGN.md` and `docs/GPU_TEST_PLAN.md` (speech), `docs/PHASE1_ARCHITECTURE.md` (server design and decisions D1–D7), `docs/DEPLOY.md` and `docs/DB_OPERATIONS.md` (running it), `docs/LEGAL_QUESTIONS_RU.md` (questions for the lawyer and Минздрав). Paused: `docs/MOBILE_PLAN.md`, `docs/PHONE_TEST.md`, `docs/PHONE_TEST_CHECKLIST.md`.

Who does what: **Claude** = I build and test it; **Owner** = you decide, record, buy, sign up or install; **Ext** = an outside party (lawyer, Минздрав, security firm, clinic IT).

Estimates are rough working time, not calendar time, and assume the owner answers within a day or two. Legal answers and outside reviews are the long poles.

## Where we are today

Built and tested on fictional data: login with a second factor, roles and patient assignment, server-side sign rules, hash-chained audit log, speech path to a local server, editable transcript with confidence highlights and drug suggestions, document types, history, database layer with encryption and backups, security scans. The screens already have a responsive layout from the earlier phone work, but it has not been checked at laptop sizes. **Not yet:** a layout designed and checked for laptops, a tested laptop microphone path, a real PostgreSQL server, real ЭЦП, Тундук, a model good enough on drug names, independent review.

Known issue found 2026-11-28: the embedded database (PGlite) fails to start when its data folder is inside a OneDrive-synced folder (OneDrive locks the files). Fix: set `DB_DIR` to a folder outside OneDrive, or move the project out of OneDrive.

---

## Progress tracker

**Last updated:** 2026-11-28 · **Overall:** Stages 0, 1, 2 and 3 are open at the same time. Stage 3 (server) is the furthest along; Stage 2 has the larger-model test done and needs a GPU machine; Stage 1 (laptop checks) and Stage 4 (clinic deployment) are not started; Stages 5–8 not started.

Legend: ✅ done · 🟡 partly done · ⬜ not started · 🚫 waiting on the owner or an outside party · ⏸ paused

| Stage | Status | Steps done / total | Notes |
|---|---|---|---|
| 0 — Housekeeping and decisions | 🟡 In progress | 2 / 7 | 0.1 CI result unchecked; 0.5 and 0.7 need the owner; 0.3 waits on the owner; 0.4 is a new question about laptops |
| 1 — Laptop web app | 🟡 In progress | 1 / 6 | 1.2 done; 1.1 built and checked at 1366×768 and 1920×1080 for the main screens (other screens still to check); 1.3 has a built capture path (works in Chrome, not tested with a real laptop microphone); the rest not started |
| 2 — Speech quality | 🟡 In progress | 1 / 8 | 2.1 done: bigger model is clearly better (18 % word errors, 4/10 drugs) but too slow on CPU (about 7× real time), so the GPU test (2.3) is now the key question. `docs/ASR_DESIGN.md` sections 9 and 9.1 |
| 3 — Real server foundation | 🟡 In progress | 3 / 7 | 3.1, 3.3 and 3.6 done; 3.4 built, waits on external write-once storage; 3.5 built, waits on review; 3.7 prepared, waits on the host; 3.2 built and tested on PGlite, waits on hosting choice (legal answer) to finish on a real PostgreSQL server |
| 4 — Clinic deployment on laptops | ⬜ Not started | 0 / 6 | Proposed 2026-11-28; needs the answer to 0.4 |
| 5 — Legal-gated integrations | 🚫 Waiting | 0 / 5 | Needs lawyer, Минздрав and vendor answers |
| 6 — Verification | ⬜ Not started | 0 / 8 | Mostly outside parties |
| 7 — Pilot | ⬜ Not started | 0 / 5 | Only after every release gate |
| 8 — Operate | ⬜ Not started | — | |
| Paused — phone and native apps | ⏸ Paused | — | Phone layout, token login, iPhone audio capture, LAN HTTPS and installable web version are built and kept; the first native step (Android project) was started but is uncommitted and untested |

Evidence: 0.1 — all tests, the build and the secret scan passed before commit `a09c206`; pushed to GitHub on 2026-11-26 with the owner's approval, and the CI run has not been checked yet. 0.2 (✅) — the 11 project copies were checked byte for byte against the originals in `C:\Users\User\medsync-asr\recordings` and moved to `C:\Users\User\medsync-asr\duplicates-from-project`.

### Changelog
| Date | Change |
|---|---|
| 2026-11-28 | Step 1.2 done: idle sign-out with warning, full-page reset on sign-out, tabs sign out together, session-only login cookie, no-store app page in the proxy config, clipboard cleared on sign-out (best effort). Checked in the browser with 45 s limit and with a second user; tests pass |
| 2026-11-28 | Step 1.1 built (not finished): laptop layout for the main screens, checked in the browser at 1366×768 and 1920×1080 — wider content, visit screen with transcript in view and an always-visible sign bar, larger small buttons, keyboard focus on facts. Other screens still to check. Build and secret scan pass |
| 2026-11-28 | Goal changed by the owner from a mobile app to a web app for laptops. Plan rewritten: Stage 1 and Stage 4 replaced with laptop work, phone and native-app steps moved to the paused section, mobile risks and timeline updated. No code changed. Also recorded the OneDrive/PGlite startup problem and its fix |
| 2026-11-26 | Plan written. Stage 0: pending work committed and pushed; recordings moved out of the project; `.gitignore` bug fixed (the `data/` rule also hid `src/data/`); legal list extended with 7 mobile questions (now 31); drug formulary template created. Owner's answers recorded: no Mac, phones over the internet, keep `dist/` |
| 2026-11-27 | Step 3.2 built: database layer (PostgreSQL via PGlite for dev/tests, `pg` for production), field encryption, migrations, backup/restore and restore drill; `docs/DB_OPERATIONS.md` |
| 2026-11-27 | Step 3.1 done: visits (transcript, draft, decisions) held by the server; signing uses server data only; old client-text endpoints removed |
| 2026-11-27 | Step 2.1 done: `large-v3-turbo` downloaded with the owner's OK (checksum verified) and tested on the 11 recordings; results in `docs/ASR_DESIGN.md` 9.1 |
| 2026-11-26 | Phone steps (now paused) built: phone layout, token login for apps, iPhone-safe audio capture, HTTPS on the LAN, installable web version; phone test checklist written |

How this is maintained: whenever a step moves, its Status cell, the stage counts, the evidence line and the changelog are updated, and `SECURITY_PLAN.md` gets a matching changelog row if the step is security-related.

---

## Stage 0 — Housekeeping and decisions (about 1–2 days)

| # | Step | Who | Done when | Status |
|---|---|---|---|---|
| 0.1 | Commit and push the work done since the last push (speech, recording tools, plans) | Claude, on the owner's go-ahead | GitHub matches the computer; CI is green | 🟡 pushed 2026-11-26 (GitHub matches the computer); CI result not yet checked |
| 0.2 | Move the real voice recordings out of the OneDrive project folder (`docs/recordings/`) | Owner | Folder not inside the project | ✅ 2026-11-26 |
| 0.3 | Turn on branch protection for `main` on GitHub | Owner | Settings → Branches rule exists | 🚫 owner |
| 0.4 | Answer: which laptops and browsers do the doctors use (Windows? Chrome or Edge?), and where should the server and speech service run: on each laptop, on one clinic computer, or on an in-country server? Is the project folder allowed to move out of OneDrive? | Owner | Answers recorded in `docs/DEPLOY.md` | ⬜ |
| 0.5 | Send `docs/LEGAL_QUESTIONS_RU.md` to a lawyer | Owner | Lawyer has the list; follow-up date set | 🟡 list ready and updated 2026-11-28 for laptops (31 questions; the 7 mobile ones moved to a "postponed" appendix and replaced by 7 laptop questions); owner to send |
| 0.6 | Get the clinic's real drug formulary (names, forms, doses) as a spreadsheet | Owner | File available to replace the demo list | 🟡 template ready; owner to supply formulary |
| 0.7 | Clean the project folder: remove unneeded files, fix ignore rules, keep voice data out of the repository | Claude, owner confirms deletions | Only needed files remain; scan rejects audio and secrets | ✅ 2026-11-26 `.gitignore` bug fixed, recordings moved out; owner chose to keep `dist/` |

## Stage 1 — Laptop web app (about 1–2 weeks)

Can run in parallel with Stages 0 and 2. Target: current Chrome and Edge on Windows laptops, screens from 1366×768 up.

| # | Step | Who | Done when | Status |
|---|---|---|---|---|
| 1.1 | Laptop layout for every screen (login, home, patients, visit, review, history): transcript and document side by side, no sideways scroll at 1366×768, readable at 1920×1080 | Claude | Checked in the browser at both sizes; keyboard-only use works | 🟡 Built 2026-11-28 and checked in the browser at 1366×768 and 1920×1080: content width raised from 1024 to 1280 px; on the visit screen the transcript stays in view (own scroll, viewport height) beside the document and the "Подписать ЭЦП" bar is always visible; small buttons enlarged; facts and the desktop tabs reachable by keyboard (focusing a fact highlights its source line; `aria-current` on tabs). No sideways scroll on home, patients, visit and history at either size. Second pass (also 2026-11-28, at 1366×768): signed-document screen, live-recording page (empty state), account page, admin and auditor screens all fit with no sideways scroll. Two fixes from it: the signed document is limited to a readable 768 px column, and the top tabs now leave the account page (before, clicking a tab while "Аккаунт" was open did nothing, and the old tab stayed highlighted). **Not yet checked:** the second pass at 1920×1080; the live-recording page with a long real transcript (needs a microphone or `ASR_ENGINE=mock`); a full keyboard-only visit (that is step 1.5). Step stays 🟡 until those are done |
| 1.2 | Shared-laptop safety: automatic sign-out after idle time, sign-out clears everything held in the page, nothing patient-related kept in browser storage | Claude | Tests pass; checked on a second user logging in on the same browser | ✅ 2026-11-28. Automatic sign-out after 10 minutes without mouse or keyboard (provisional, set per build with `VITE_IDLE_LIMIT_MS`), with a warning for the last minute and a "stay signed in" button; recording from the microphone counts as activity, so a long visit is not cut off; while the doctor works, a heartbeat keeps the server session alive (the server still expires it after 15 idle minutes and 8 hours in total). Signing out (button, idle, or the server losing the session) reloads the page, so everything held in memory is dropped, and the login page says why; other tabs of the same browser sign out too (tabs exchange only "activity" and "logout" signals, no data). The login cookie is now a browser-session cookie (no `Max-Age`). A page restored by back/forward is reloaded. The app page is `no-store` in `deploy/Caddyfile`. Copied transcript text is cleared from the clipboard on sign-out (best effort; browsers allow it only when the page has focus). Nothing is kept in `localStorage`, `sessionStorage` or caches (checked on a logged-in page). Tests: 14 new in `src/session/idle.test.ts`, one new in `server/net.test.ts`, all suites pass. Browser checks: idle sign-out, warning, a key press cancelling the warning, a request after the server forgot the login, two tabs signing out together, and a second user seeing only their own patients. **Not checked:** the real 10-minute limit (tested with 45 s), `Caddyfile` change (Caddy not installed), clipboard clearing, a recording longer than the limit, Edge. Open points: the limit needs the clinic's agreement; password-manager prompts on shared laptops belong to step 4.3 |
| 1.3 | Microphone path on Windows laptops: choose the input device, clear permission and "recording" indicator, handle a unplugged or busy microphone, keep the transcript text if the page is interrupted | Claude | Works in Chrome and Edge with the built-in and a headset microphone | 🟡 Capture exists (`src/audio/capture.ts`, 16 kHz, resampler with tests, interruption handling, Wake Lock) and works in Chrome; not tested with a real laptop microphone or in Edge, and no device chooser yet |
| 1.4 | Supported-browser check: a clear message for unsupported or too-old browsers, and a short list of what is tested | Claude | Page shows the message; list in `docs/DEPLOY.md` | ⬜ |
| 1.5 | Keyboard shortcuts and speed: start/stop recording, move between flagged facts, confirm and sign without the mouse | Claude | Doctor can finish a fictional visit using the keyboard only | ⬜ |
| 1.6 | First laptop test session: record the script on a laptop microphone in Chrome and Edge, run a whole fictional visit, note problems | Owner, Claude fixes | List of issues closed | 🚫 Waiting on the owner |

## Stage 2 — Speech quality (about 2–4 weeks, in parallel)

Decides whether "record the whole conversation" is viable. The `small` model got drug names right 1 time in 10, so this is the biggest risk. A laptop can run a bigger model than a phone could, which makes this stage more promising, but a CPU-only laptop was about 7× slower than real time with the best model tested.

| # | Step | Who | Done when | Status |
|---|---|---|---|---|
| 2.1 | Download and test `large-v3-turbo` (and optionally `medium`) on this CPU with the 11 recordings (owner's OK needed for each download) | Claude, owner approves | Comparison table in `docs/ASR_DESIGN.md` | ✅ `large-v3-turbo` tested on 2026-11-27 (table in `docs/ASR_DESIGN.md` section 9.1): word error rate 27 % → 18 %, drug names 1/10 → 4/10, numbers 91 % → 95.5 %, but about 7× slower than real time on this CPU. `medium` was not downloaded or tested |
| 2.2 | Record the script again on **laptop microphones** (built-in and headset) in clinic-like rooms, with several speakers, plus silence and noise files; target 30–60 minutes | Owner and colleagues | Recordings collected, kept outside the repository | ⬜ |
| 2.3 | GPU speed test on an NVIDIA machine (own PC, rented GPU for a few hours, or clinic server) | Owner provides the machine, Claude runs | Speed and accuracy numbers recorded | ⬜ |
| 2.4 | Replace the demo drug list with the clinic formulary; improve suggestions (phonetic matching, forms and doses) | Claude | Suggestion coverage re-measured on the recordings | ⬜ |
| 2.5 | Formulary drug picker next to the transcript: drugs and doses are confirmed by clicking, not trusted from speech | Claude | Allergy check uses picked drugs; tested | ⬜ |
| 2.6 | Decide speaker handling: manual buttons, two microphones, or server-side separation (test one) | Claude proposes, owner decides | Decision recorded | ⬜ |
| 2.7 | Set the confidence threshold and the pass bars with practising doctors | Owner with doctors | Bars written in `docs/ASR_DESIGN.md` | ⬜ |
| 2.8 | **Decision point:** if no model meets the bars on whole-conversation audio, switch to doctor dictation plus drug picker | Owner | Written decision | ⬜ |

## Stage 3 — Real server foundation (about 3–5 weeks)

Closes the known limits listed in `docs/PHASE1_ARCHITECTURE.md` section 2. Depends on the hosting decision (legal answer) for the database choice, but the design work can start earlier.

| # | Step | Who | Done when | Status |
|---|---|---|---|---|
| 3.1 | Server holds the transcript, draft and the doctor's decisions; signing uses what the server holds, not what the client sends | Claude | Tests prove the client cannot alter signed text | ✅ Done (in-memory store; the database comes in 3.2). Visits live on the server (`server/visits.ts`, `POST/GET /api/visits…`): transcript, draft and the doctor's decisions are stored there, and `/sign` takes no text from the client. The old `/api/sign` and `/api/extract` are removed. Tests (130 in `server/app.test.ts`): same server content gives the same hash whatever the client sends; forged "checked/acknowledged" claims are ignored; edits after signing are refused; other doctors get 404; invalid keys, actions and lines are rejected. Also checked in the browser against a throwaway server: block → resolve → sign, with decisions and the change log coming from the server. Not yet: resuming an open draft after a refresh, and moving the history from the browser to the server (3.3) |
| 3.2 | Real database (PostgreSQL), encryption at rest, migrations, backups, restore drill | Claude, Ext for hosting | Restore tested from a backup | 🟡 Built and tested on PostgreSQL (PGlite), not yet on a real PostgreSQL server or hosting. Visits are stored in table `visits` with the medical content in one AES-256-GCM encrypted field bound to visit, doctor and patient; signed visits are immutable even by direct SQL; versioned writes (no lost updates); checksummed migrations; `npm run db:backup / db:restore / db:drill`. Restore drill passed (5 visits, 1 signed, 0 integrity problems; hashes of signed documents recomputed). 51 database checks plus the 130 app checks re-run on the PostgreSQL store. Needs the owner/hosting: server choice and location (legal answer), disk encryption, backup schedule, RPO/RTO. Known limits: no re-encryption of old records after a key change; PGlite fails to start in a OneDrive-synced folder (found 2026-11-28; use `DB_DIR` outside OneDrive). Details: `docs/DB_OPERATIONS.md` |
| 3.3 | Patients, history and drafts served from the server with access checks; remove patient data from the web bundle | Claude | No patient data in the app bundle | ✅ 2026-11-27: patients and history come from the server (`GET /api/patients`, `GET /api/visits`), a doctor sees only their own assigned patients and visits, drafts can be resumed from the history; `scripts/bundle.test.ts` and a grep of `dist/` find no patient data. Known limits: the demo "sent to medical record" status is no longer stored (signed visits are immutable, and there is no real integration yet); the drug-group table for allergy warnings is still in the app code |
| 3.4 | Audit log to write-once storage, retention rules, alerts on unusual access | Claude, Ext for storage | Tamper test passes against external storage | 🟡 Built 2026-11-27, waits on the external storage. Log now lives in a database table that only accepts appended rows (update, delete, truncate and out-of-order inserts are refused by the database itself, tested), is included in backups and the restore drill, and a failed log write stops the server (503). Alerts: denial bursts, password guessing, token reuse, mass reading, night access, shown to the auditor and written to the log. Retention is a setting (`AUDIT_RETENTION_YEARS`, provisional 5) with a report; nothing is deleted automatically. `npm run audit:anchor` / `audit:check` save and verify a log fingerprint that detects truncation or a full rewrite. **Still open:** the tamper test against real external write-once storage (needs the hosting choice, Ext), the legal retention period, and sending alerts outside the app (3.7) |
| 3.5 | Account management: password change and reset, second-factor enrolment, user admin, break-glass access with alerts | Claude | Flows tested; reviewed | 🟡 Built 2026-11-27, needs the independent review. Users now live in an encrypted database table (`users`, migration 0003; old `data/users.json` is imported once). Self-service: change password (current password and code required, other logins ended, weak and reused passwords refused), re-enrol the second factor (new secret confirmed with a code before it replaces the old one). Admin: create, block, unblock, reset password or password plus second factor, assign patients; admin sees no medical data. One-time passwords force the user to set their own password and a fresh second factor before anything else (enforced by the server). Break-glass: a doctor opens an unassigned patient by PIN with a reason from a fixed list, 30 minutes, at most 3 cards, read and visit work only (no signing), every case in the audit log and as an alert for the auditor. 202 app tests, 78 database tests. **Still open:** reset by e-mail or SMS for people who lost both password and admin access (needs a mail provider, 3.7), a QR code for the secret, checking new passwords against a list of leaked passwords, the independent security review (Stage 6) |
| 3.6 | Transcript edit history (who changed which line when) in the audit log | Claude | Edits visible to the auditor role | ✅ 2026-11-27: live recording now sends each speech segment to the visit on the server (`POST /api/visits/:id/asr`), so the recognised text is kept as it came from the model; every doctor edit (text, speaker, delete, manual line) goes to `POST /api/visits/:id/lines` and is stored with who, when, before and after (encrypted with the visit, frozen at signing). The audit log gets one record per change with the visit, line number and kind of change, no text; the auditor screen lists them (`GET /api/audit/edits[/:visit]`). The doctor sees the full before/after list under the document. 223 app tests. Not checked with a real microphone in this step (no microphone in the test browser) |
| 3.7 | Internet-facing hardening: public HTTPS and HSTS, reverse proxy or firewall, speech service kept private, alerts on login anomalies, DoS plan (`docs/DEPLOY.md`) | Claude, Ext for the host | Scanner grade acceptable | 🟡 Prepared 2026-11-28, waits on the host (legal answer). Server side done and tested: real client address behind the proxy, security headers on the API, `__Host-` cookie, allowed host from `PUBLIC_ORIGIN`, slow-client timeouts, strict CSP possible (offline page without inline code), new login alerts (credential stuffing from one address, login after failures, login from a new address) and delivery by webhook or Telegram without patient data. Ready to use but **not run**: `deploy/Caddyfile`, `deploy/medsync.service`, `deploy/firewall.sh`, `docs/DEPLOY.md` with the DoS and no-server plan, and `npm run check:site` that grades a published site. **Still open:** pick the host, run Caddy, SSL Labs A, Observatory B+, securityheaders A |

## Stage 4 — Clinic deployment on laptops (about 2–3 weeks, proposed)

New in this plan. Needs the answer to 0.4 (which laptops, where the server and speech service run). All steps below are proposals for you to confirm or change.

| # | Step | Who | Done when | Status |
|---|---|---|---|---|
| 4.1 | Decide where the speech service and the server run: each laptop, one clinic computer, or an in-country server; record the decision and the machine requirements (CPU or GPU, memory, speed per minute of audio) | Claude proposes, owner decides | Decision in `docs/DEPLOY.md` | ⬜ |
| 4.2 | Install guide and scripts for Windows: server, database, speech service, start on boot, update and rollback | Claude drafts, clinic IT or owner tests | A clean Windows machine runs MedSync following only the guide | ⬜ |
| 4.3 | Clinic workstation rules: supported browsers, Windows user accounts per person, screen lock, no browser extensions on the work profile, no password saving for MedSync | Claude drafts, Ext (clinic IT) applies | Written rules; checked on one laptop | ⬜ |
| 4.4 | Print and PDF of signed documents: A4 layout, doctor, clinic and signature details, readable in Russian | Claude | Printed sample accepted by a doctor | ⬜ |
| 4.5 | "MedSync is unavailable" procedure and monitoring: what the doctor does, who is told, how the clinic checks the server is up | Claude drafts (`docs/DEPLOY.md` has a start), clinic agrees | Procedure agreed in writing | ⬜ |
| 4.6 | Backups on the clinic side: schedule, off-machine copy, restore drill on the clinic machine, key custody | Claude, owner and clinic IT | Restore drill passed on the clinic setup | ⬜ |

## Stage 5 — Integrations that wait for legal answers

Start each only after the matching answer arrives; design notes already exist in `docs/PHASE1_ARCHITECTURE.md`.

| # | Step | Needs | Done when | Status |
|---|---|---|---|---|
| 5.1 | Real ЭЦП behind the existing `Signer` interface, key stays on the doctor's side | Accepted scheme, doctor keys | Signature verifiable by a third party | ⬜ |
| 5.2 | Тундук connection and the medical-record format | Agreement with Минздрав, operator specification | Test document accepted by a test environment | ⬜ |
| 5.3 | Language-model step: de-identify text, then a model inside the jurisdiction or a signed processing agreement | Legal answer, vendor contract | Written approval; de-identification tests pass | ⬜ |
| 5.4 | Consent and privacy notice screens in the web app, in Russian (later Kyrgyz), lawyer-approved text | Lawyer | Consent stored and auditable | ⬜ |
| 5.5 | Recording retention: automatic deletion of anything held, per the lawyer's rule | Lawyer | Deletion tested | ⬜ |

## Stage 6 — Verification (about 4–8 weeks, mostly waiting for outsiders)

| # | Step | Who | Done when | Status |
|---|---|---|---|---|
| 6.1 | Add a code scanner (Semgrep) to CI; pin GitHub Actions to commit versions; software bill of materials | Claude | Scanner runs on every push | ⬜ |
| 6.2 | Authorization, replay and session tests for the API; fuzzing of the audio and API endpoints | Claude | Tests pass | ⬜ |
| 6.3 | Language-model attack tests re-run with the real model; extraction test set grown | Claude, needs API key | Results recorded | ⬜ |
| 6.4 | Browser-side security review (session handling, storage, content security policy, cross-site scripting, shared-laptop behaviour) | Ext | No open critical or high findings | ⬜ |
| 6.5 | Independent penetration test, tested from the internet, of the web app, API and infrastructure; fix and retest | Ext | Report with no open critical or high findings | ⬜ |
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

Vulnerability handling with deadlines, annual and change-triggered penetration tests, quarterly access reviews, key rotation, model and prompt change control with the regression set, staff training, Kyrgyz language, more document types, more clinics. Phone and native apps can be taken up again here if the owner decides so.

---

## Paused: phone and native-app work

Set aside on 2026-11-28 when the goal changed to laptops. The code from P1–P5 below stays in the repository and keeps working. The Android project (P7) is only a first, uncommitted start. Resume only if the owner asks.

| # | Step | Status when paused |
|---|---|---|
| P1 | Responsive phone layout for every screen | 🟡 Built: bottom tab bar, cards instead of tables, 44 px targets, 16 px inputs, safe-area insets, sticky sign button. Checked: no sideways scroll, no button under 40 px (login, all tabs, review screen) at 375 px. Not checked: real phone, live-recording page |
| P2 | Token login for apps: short-lived tokens, refresh, revocation, CORS and Origin rules for app origins | ✅ Server side done: `POST /api/login` with `client:"app"` returns an access token (5 min) and a one-time refresh token (rotating; reuse revokes the whole login); idle 5 min, absolute 8 h; `POST /api/token/refresh`; logout revokes; CORS only for `APP_ORIGINS`; cookie and token sessions cannot be swapped or sent together. App-side client and secure storage were not built |
| P3 | Audio capture that works on iPhone (resample to 16 kHz, interruptions, Wake Lock) | 🟡 Built: `src/audio/resample.ts` (13 tests) and `capture.ts`. Not tested on a real iPhone. The capture layer is also what the laptop microphone path (step 1.3) uses |
| P4 | Local HTTPS on the LAN for phone tests (`npm run dev:lan`, guide in `docs/PHONE_TEST.md`) | 🟡 Built and checked on this PC; no phone ever tried it |
| P5 | Installable web version (PWA): manifest, icons, a service worker that caches only the "no connection" page | 🟡 Built and checked in the browser pane; not installed on a real phone |
| P6 | First phone test session (`docs/PHONE_TEST_CHECKLIST.md`) | ⏸ Never run |
| P7 | Native iPhone and Android apps: Capacitor, secure token storage, app lock, screenshot block, TestFlight and Android distribution, lost-phone procedure (7 steps) | ⏸ Step 4.1 had just been started when the goal changed: Capacitor project (`capacitor.config.ts`, `android/`, `scripts/android.ts`, `docs/ANDROID.md`) exists in the working tree, **uncommitted** and never run on a phone. The other six steps were not started. iPhone would need a cloud macOS builder; Apple and Google developer accounts not created |

---

## What can run in parallel

- Stages 1, 2 and the design work of 3 can run together; they need the owner mainly for recordings and decisions.
- The lawyer's answers (step 0.5) should be requested immediately because they gate Stage 5 and the hosting choice.
- Stage 4 starts when the owner answers 0.4; the install guide can be drafted before the hosting decision.

## Biggest risks

1. **Speech accuracy on whole conversations** (drug names). Mitigation: Stage 2, with the dictation fallback at 2.8.
2. **Legal answers arrive late** (data location, ЭЦП, Тундук). Mitigation: send the questions now; build everything that does not depend on them.
3. **Shared clinic laptops with mixed browsers and settings.** Mitigation: Stage 1.2 and 1.4, workstation rules in 4.3, a short supported-browser list.
4. **Home-grown authentication.** Mitigation: independent review in 6.6; consider a national identity service.
5. **Whole-conversation recording captures the patient's voice.** Mitigation: consent and retention rules (5.4, 5.5), nothing stored.
6. **Speech and the server running on weak clinic hardware.** Mitigation: decision 4.1 with measured requirements, GPU test 2.3.

## Rough overall timeline

| Period | Work |
|---|---|
| Weeks 0–2 | Stage 0, Stage 1 start, 2.1–2.2 |
| Weeks 2–8 | Stages 1–3 in parallel; speech decision at 2.8 |
| Weeks 6–10 | Stage 4 (clinic deployment); Stage 5 as answers arrive |
| Weeks 10–18 | Stage 6, mostly outside parties |
| Weeks 18+ | Stage 7 pilot, only if every gate is met |

These are planning estimates. The real schedule is set by the legal answers, the outside reviews and the speech results. Dropping the native apps shortens the plan by several weeks compared with the mobile version.
