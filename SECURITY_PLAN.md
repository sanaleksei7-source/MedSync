# MedSync — Cybersecurity Assurance Plan

Goal: bring MedSync from a fictional-data demo to a system that can be used with real patient data under the Ministry of Health (Минздрав) of the Kyrgyz Republic.

**Status of this document:** a plan, not a certification. Nothing here has been performed yet except the items marked ✅. Legal and regulatory statements marked ⚖ must be confirmed by a Kyrgyz lawyer and by Минздрав / the Tunduk operator; they are not legal advice.

---

## Progress tracker

**Last updated:** 2026-11-27 · **Overall:** Phase 0 in progress. No real-data release gate (§5) is met yet.

Legend: ✅ done · 🟡 partly done · ⬜ not started · 🚫 blocked (needs someone outside development)

### Phase summary

| Phase | Status | Done / total items | Notes |
|---|---|---|---|
| 0 — Governance and threat model | 🟡 In progress | 1 / 8 | Plan written; legal answers and threat model still missing |
| 1 — Architecture decisions | 🟡 Prototype started | 0 / 9 (6 partly, 2 blocked, 1 not started) | Login, roles, server-side rules and audit log prototyped on fictional data; speech, model, ЭЦП and Tunduk wait for the Phase 0 legal answers |
| 2 — Secure implementation | 🟡 Started (partial) | 0 / 7 (7 partly) | Quick wins written and tested locally; CI not yet run on GitHub; no auth yet |
| 3 — Verification | ⬜ Not started | 0 / 7 | Needs a staging environment and Phase 1–2 output |
| 4 — Controlled pilot | ⬜ Not started | 0 / 3 | Only after the §5 gates |
| 5 — Operate and re-certify | ⬜ Not started | 0 / 5 | |

### Phase 0 — Governance and threat model
- ✅ Security plan written and committed (`SECURITY_PLAN.md`)
- ⬜ Appoint a security owner and a data-protection contact
- 🚫 Legal confirmations (§3): data residency, consent, ЭЦП scheme, Tunduk terms, retention, who may audit — **question list for the lawyer and Минздрав prepared** (`docs/LEGAL_QUESTIONS_RU.md`, 24 questions in Russian); answers not received
- ⬜ Data-flow diagram of every place patient data goes
- ⬜ STRIDE threat model per data flow, and risk register with owners
- ⬜ Data classification and log policy (no patient content, no ПИН in logs)
- 🚫 Hosting model decision (depends on the legal answers)
- 🚫 Lawyer-reviewed consent text and privacy notice (the current footer is only a demo disclaimer)

### Phase 1 — Architecture decisions
Details and decision records: `docs/PHASE1_ARCHITECTURE.md`.
- 🟡 Speech recognition inside the approved jurisdiction — done: the browser Web Speech API is **removed**; microphone audio now goes browser → authenticated server → a speech service on the clinic machine, with a code-enforced local-only address policy, silence and hallucination filtering, in-memory handling and duration-only audit records (`docs/ASR_DESIGN.md`). Missing: a larger model on a GPU (on the owner's real voice the `small` model got drug names right 1 time in 10), more speakers and rooms, silence-only recordings (a 5-sentence synthetic check found misspelled drug names, a broken medical phrase and invented text on noise), a GPU and larger model, verification of the speech service's own logging and temp files, in-clinic https if it is not on the same machine. First real run: whisper.cpp + `small` on a CPU-only laptop, see `docs/ASR_DESIGN.md` section 7
- 🚫 Language-model hosting or processing agreement, plus de-identification before sending — decision record D2 written; blocked by the legal answer on cross-border transfer
- 🟡 Backend and database — done: HTTP API with authenticated routes (login, session, sign, extract, audit verify). Missing: a real database, encryption at rest, backups and restore test, tenant isolation, TLS (storage is currently JSON files)
- 🟡 Doctor login with MFA — done (prototype, fictional users): scrypt passwords, TOTP second factor checked against the RFC 6238 test vector, lockout after 5 failures, HttpOnly SameSite=Strict sessions with idle and absolute expiry, no account enumeration. Missing: independent review, password change/reset, MFA enrolment, user management; decision D6 (own accounts vs a state identity service)
- 🟡 Server-side RBAC and "treating relationship" check — done: doctor / admin / auditor roles, doctors reach only assigned patients, tested over HTTP. Since 2026-11-27 also: break-glass access with alerts (dev plan 3.5) and no patient data in the web bundle (3.3). Missing: independent review, real patient source
- 🚫 Real ЭЦП integration — the signing step now sits behind a `Signer` interface; the current implementation is an HMAC demo with no legal force. Blocked by which scheme is accepted (D3)
- 🚫 Tunduk integration design — decision record D4 written; blocked by the operator's specification and the agreement
- 🟡 Tamper-evident, persisted audit log — done: append-only hash-chained file; editing, removal, reordering and truncation are detected; logs ids, actions and document hashes only (no medical text, names or ПИН); an auditor role can verify it. Since 2026-11-27 (dev plan 3.4) the log is a database table that refuses update, delete, truncate and out-of-order inserts, is part of backups and the restore drill, and a failed write stops the server; alerts on denial bursts, password guessing, token reuse, mass reading and night access; fingerprint (anchor) check against truncation or full rewrite. Missing: copying anchors/log to real external write-once storage (hosting decision), legal retention period, sending alerts outside the app
- ⏸ Mobile client security (paused 2026-11-28: the goal is now a web app for laptops, so this item is not on the critical path; for laptops see browser-side review and shared-laptop safety in `docs/DEVELOPMENT_PLAN.md` steps 1.2 and 6.4. Originally added 2026-11-26 for an iPhone and Android app; plan in `docs/MOBILE_PLAN.md`) — token authentication for native clients stored in Keychain/Keystore (the cookie login will not work from an app), HTTPS everywhere, app lock and biometrics, screenshot and app-switcher protection, no audio on storage, backup exclusion, lost-phone procedure, mobile security review. Not started

### Phase 2 — Secure implementation
- 🟡 Secure SDLC — done: Dependabot config written (`.github/dependabot.yml`). Missing: branch protection and mandatory review on `main` (a GitHub repository setting the owner must switch on), signed releases
- 🟡 CI gates — done and **green on GitHub** (2026-11-24, commit `4b23bf3`): `ci.yml` build, tests, secret/ПИН scan and `npm audit --audit-level=high` (22 s), and gitleaks (5 s). CodeQL was **dropped** on 2026-11-24 after it failed on its first run (likely needs paid GitHub Advanced Security on a private repository; cause not confirmed from the log), so there is currently **no automated code-vulnerability scan (SAST)**. Missing: a replacement SAST (for example Semgrep, or CodeQL if Advanced Security is bought), pinning actions to commit SHAs, SBOM, DAST
- 🟡 Web hardening — done: strict CSP in the production build and in the preview server, plus `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`; verified in the browser with no console errors. Missing: HSTS and `frame-ancestors` on the real host, CSRF and cookie flags (no sessions exist yet)
- 🟡 API hardening — done: request validation, 1 MB body limit, 400-line limit, refuses to run without a key, no internals in errors, Origin allow-list, Host check (DNS-rebinding), JSON-only content type, 10 requests/min per address, 2-minute request timeout, `no-store` and `nosniff` on responses. Now also: session authentication, role checks, per-user limit on model calls (10/min), required `X-Requested-With` header on POST (see Phase 1). Missing: quotas by clinic, a review of the auth code
- 🟡 Secrets — done: `.env` is gitignored, `.env.example` committed, key never reaches the browser, `npm run scan` fails on API keys, private keys and ПИН-like numbers that are not the demo patients. Missing: secrets manager, rotation, separate keys per environment, a pre-commit hook
- 🟡 LLM-specific controls — done: server-side sanitizer, transcript treated as data in the prompt, an attack and invention test set (7 fictional cases, including prompt injection) with a scorer and `npm run eval`. Missing: the eval has **never run against the real model** (needs an API key), output checks before signing, model/prompt version logging
- 🟡 Clinical-safety logic — done: sign-blocking rules (unreviewed unsourced facts, unresolved allergy conflicts) moved into a tested, UI-independent module (`src/domain/rules.ts`). Now also enforced on the server: `/api/sign` recomputes allergy conflicts from the transcript and re-checks unsourced facts, so a client cannot bypass them (integration-tested). Missing: server-held drafts (the text still comes from the client), real drug database, hazard analysis

### Phase 3 — Verification
- ⬜ Automated SAST/DAST on staging, dependency, container and IaC scans
- ⬜ Authorization matrix, IDOR, session, MFA, audit-tamper and replay tests
- ⬜ LLM red-teaming: prompt injection, invented diagnoses or doses, prompt exfiltration, Russian/Kyrgyz/mixed input
- 🚫 Independent penetration test and re-test (external firm)
- 🚫 Independent code review of auth, signing, audit log and data access
- ⬜ Privacy review / DPIA, signed off by the data-protection contact and the lawyer
- ⬜ Resilience tests: backup restore, failover, DoS behaviour, degraded mode

### Phase 4 — Controlled pilot
- ⬜ One-clinic pilot with real data only after Phase 3 sign-off and legal approval
- ⬜ Tested incident-response plan and security monitoring
- ⬜ Pilot metrics and stop criteria in use

### Phase 5 — Operate and re-certify
- ⬜ Vulnerability management with SLAs
- ⬜ Annual and change-triggered penetration tests
- ⬜ Quarterly access reviews, key rotation, backup restore tests, tabletop exercise
- ⬜ Change control: regression set before every model, prompt or drug-database change
- ⬜ Clinic staff security training

### Evidence collected so far
- `npm audit`: 0 known vulnerabilities (2026-11-24)
- Code search: no `eval`, `innerHTML` or `dangerouslySetInnerHTML` in `src/` or `server/` (2026-11-24)
- `npm test` passes locally: ПИН format, model-output sanitizer, API guards (13 checks), sign/allergy rules (10 checks), attack-set scorer (6 checks) (2026-11-24)
- `npm run scan`: passes on the repository, and fails as intended on a planted fake API key and a planted ПИН-like number (2026-11-24)
- Live API test with hostile requests: foreign `Origin` → 403, form content type → 415, 11th request in a minute → 429, GET → 404, no key → 503 with a clear message (2026-11-24). The Host-header check is covered by a unit test only, because the test client cannot forge a Host header
- Production build served with the new headers: CSP present, app works end to end, no browser console errors (2026-11-24)
- Integration test of the whole server in one process, 36 checks (login, lockout, no enumeration, cookie flags, CSRF headers, roles, patient assignment, sign blocking and success, audit privacy and tamper detection over the API, logout), no API key needed (2026-11-24)
- Live smoke test against the running server (`npm run smoke`): doctor login 200; sign with allergy conflict 409; another doctor's patient 403; sign after removing the order 200; extract without a key returns a clear error; auditor verification of a 7-record chain ok (2026-11-24)
- Browser: the app shows only the login form before sign-in, and a wrong password shows a generic error. **Not checked in the browser:** the signed-in screens and signing through the new API (no way to type the seeded fictional password into the page without exposing it); these are covered by the integration and smoke tests instead (2026-11-24)
- GitHub Actions on `4b23bf3` (2026-11-24): CI build-test ✅ green, gitleaks ✅ green, CodeQL ❌ failed after 3 min (error text not read) → removed from the repository
- Speech path tests (2026-11-25): engine layer 28 checks (local-only address policy, WAV handling, hallucination filter, fake whisper.cpp server), accuracy metrics 19 checks, pause segmenter 11 checks (run 5 times; found and fixed a short-click flaw), `/api/asr` integration 16 checks (auth, role, size and format limits, silence skipped, no text in the audit log, rate limit). Browser: audio worklet loads under the strict CSP and yields 16 kHz float frames. **Done 2026-11-26:** real microphone and real model (`small`) used once by the owner; synthetic 5-sentence check run through `npm run asr:eval`. **Not verified:** accuracy on real voices and rooms, a larger model, the speech service's own logs and temp files
- Not yet verified: any SAST; the extraction call and `npm run eval` have never run against the real model (no API key available to development)

### Changelog
| Date | Change |
|---|---|
| 2026-11-24 | Plan written; progress tracker added; Phase 0 started |
| 2026-11-24 | Phase 2 quick wins: CI/CodeQL/Dependabot/gitleaks config, secret and ПИН scan, API guards, CSP and security headers, shared sign/allergy rules with tests, LLM attack test set |
| 2026-11-24 | First GitHub run of the workflows: CI and gitleaks green, CodeQL failed |
| 2026-11-24 | CodeQL workflow removed by decision; SAST gap recorded |
| 2026-11-24 | Phase 1 prototype: login with TOTP, sessions, roles and patient assignment, server-side sign rules, hash-chained audit log, Signer interface, decision records D1–D7 (`docs/PHASE1_ARCHITECTURE.md`) |
| 2026-11-25 | Question list for the lawyer and Минздрав written (`docs/LEGAL_QUESTIONS_RU.md`, 24 questions, Russian); no answers yet |
| 2026-11-25 | Speech recognition moved off the browser API to a clinic-local service path (`/api/asr`, segmenter, filters, accuracy metrics and eval CLI, `docs/ASR_DESIGN.md`); no model run yet |
| 2026-11-26 | First real speech run (whisper.cpp + small model, checksums verified, CPU laptop): chain works; found misspelled drug names, lost decimal ("378"), invented text on noise. Added per-word confidence, number underline, one-click drug suggestions, sound-annotation filter. Model is confident when wrong, so review stays mandatory |
| 2026-11-26 | Real-voice test (owner's 11 recordings, small model, CPU): word error 27 %, drug names right 1 of 10, numbers 91 %; confidence flags caught 49 % of errors at 0.5 and 76 % at 0.7 (threshold changed to 0.7); drug suggestions would fix 5 of 10. Conclusion: not trustworthy for medical terms on this setup; review mandatory; larger model on GPU is the next test (`docs/ASR_DESIGN.md` section 9) |
| 2026-11-26 | Larger-model and GPU test planned (`docs/GPU_TEST_PLAN.md`): accuracy of `large-v3-turbo` / `medium` on this CPU first, GPU speed second; not started, needs owner's OK for downloads |
| 2026-11-26 | Mobile token login built on the server (dev plan 1.2): access 5 min + rotating one-time refresh token, reuse detection revokes the login, 5 min idle / 8 h absolute, only hashes stored, CORS limited to listed app origins without credentials, cookie and token sessions cannot be mixed. Still open: storing tokens in Keychain/Keystore (Stage 4), independent review |
| 2026-11-28 | Internet-facing preparation (dev plan 3.7): proxy-aware client address (cannot be spoofed from outside), API security headers with HSTS, `__Host-` session cookie, host/origin from `PUBLIC_ORIGIN`, slow-client timeouts, offline page without inline code so a strict CSP works; login anomaly alerts (stuffing, login after failures, new address) with address tags instead of addresses; alert delivery by webhook or Telegram (ids only); Caddy, systemd and firewall files, DoS and no-server plan, `check:site` grader. Not run on a real host yet. |
| 2026-11-27 | Transcript edit history (dev plan 3.6): recognised speech is attached to the visit by the server, every doctor edit is kept with author, time, before and after inside the encrypted visit and frozen at signing; the audit log records visit, line number and kind of each change without text, and the auditor can list them. |
| 2026-11-27 | Account management (dev plan 3.5): users in an encrypted database table; self-service password change and second-factor re-enrolment with the old credentials required and other logins ended; admin creates, blocks, resets and assigns users (no medical data access); one-time passwords force a new password and a new second factor before any work (server-enforced); break-glass access by PIN and fixed reason, 30 minutes, 3 cards, no signing, alert to the auditor on every case; blocked users lose all logins at once. Not yet independently reviewed. |
| 2026-11-27 | Audit log hardened (dev plan 3.4): stored in an append-only database table (triggers refuse update, delete, truncate, gaps and wrong chain links), included in backups and the restore drill; failed log write stops the server (503); alert rules (denial bursts, password guessing, token reuse, mass reading, night access) write `alert.*` records and show to the auditor; `audit:status` / `audit:anchor` / `audit:check` for retention report and external fingerprint. Not yet tested against real external write-once storage. |
| 2026-11-27 | Patients and history now come from the server (dev plan 3.3): the patient list lives only in server code, `GET /api/patients` returns just the doctor's assigned patients, `GET /api/visits` lists only their own visits without any conversation or document text, drafts resume from the history; patient data is no longer in the web bundle (checked by `scripts/bundle.test.ts` and a search of the built files); browser `localStorage` history removed. |
| 2026-11-27 | Database layer (dev plan 3.2): visit content encrypted per record with AES-256-GCM bound to visit, doctor and patient (tampering, swapped rows, changed owner/patient detected); signed visits immutable at database level; versioned writes; checksummed migrations; encrypted backups, restore into an empty database in one transaction, restore drill that recomputes signed-document hashes. Not done: disk-level encryption and backup schedule (hosting), re-encryption after key rotation, test against a real PostgreSQL server, audit log still in a file (3.4) |
| 2026-11-27 | Server now holds the transcript, draft and the doctor's decisions (dev plan 3.1): signing hashes what the server holds, client-supplied text is no longer accepted, signed visits are immutable, visits are owner-only (others get 404), per-user cap on open drafts; audit records ids and counts, no text. Closes the "client sends the text to be signed" limit in `docs/PHASE1_ARCHITECTURE.md`. Still open: durable storage (3.2), draft resume, history on the server (3.3) |
| 2026-11-26 | Goal changed to a mobile app (iPhone and Android, online only, whole-conversation recording); mobile plan written (`docs/MOBILE_PLAN.md`); mobile security items added to Phase 1; nothing built yet |
| 2026-11-26 | Step-by-step development plan written (`docs/DEVELOPMENT_PLAN.md`, stages 0–8); no steps started |
| 2026-11-26 | Housekeeping: `.gitignore` rule `data/` also hid `src/data/` (fixed to `/data/`); voice recordings moved out of the OneDrive project folder; audio files git-ignored and rejected by the secret scan; legal question list extended with 7 mobile-app questions (31 total) |
| 2026-11-26 | Owner decided phones reach the server over the internet and there is no Mac: internet-facing hardening requirements recorded (`docs/MOBILE_PLAN.md` section 8); penetration test must be run from the internet; pushed all work to GitHub |
| 2026-11-28 | Goal changed by the owner from a mobile app to a web app for laptops. Mobile client security item paused (token login code stays in the repository, unused); `docs/DEVELOPMENT_PLAN.md` rewritten with laptop stages (shared-laptop safety, browser-side security review, clinic workstation rules). Internet-facing hardening (`docs/DEPLOY.md`) still applies. No security control was removed. Also found: the embedded database fails inside a OneDrive-synced folder; use `DB_DIR` outside OneDrive |

How this tracker is maintained: whenever a security task lands, its line above changes status, the counts in the phase summary are updated, the evidence list gets what was checked and how, and a row is added to the changelog.

---

## 1. Honest current state (as of commit `abda24a`)

MedSync today is a **demo**. It must not be used with real patient data.

| Area | Current state | Risk if used for real |
|---|---|---|
| Authentication / roles | None. Anyone who opens the page is "the doctor" | Critical |
| Data storage | Encrypted PostgreSQL/PGlite store (3.2); history and patients served by the server (3.3); audit log still a local file (3.4) | High (production hosting, disk encryption and backup schedule not set up) |
| Electronic signature | Simulated: SHA-256 of the text, no key, no certificate | Critical: no legal force, no non-repudiation |
| Send to medical record | Simulated; no Tunduk integration | Not applicable yet |
| Speech recognition | Browser Web Speech API: audio goes to Google/Microsoft | Critical: patient audio leaves the country, no agreement |
| LLM extraction | Transcript sent to Anthropic API via local Node server | Critical: patient data to a foreign processor, no agreement |
| API server | Plain HTTP on localhost, no auth, no rate limit, no logging policy | High if ever deployed |
| Audit log | Only an in-memory/UI change log of doctor decisions | High: not tamper-evident, not persisted |
| Secrets | `ANTHROPIC_API_KEY` in `.env`, gitignored | Medium (OK locally; needs a secrets manager in production) |
| Dependencies | ✅ `npm audit`: 0 known vulnerabilities (23 Nov+ run). No `eval`/`innerHTML`/`dangerouslySetInnerHTML` in `src/` or `server/` | Low today; needs continuous monitoring |
| Medical safety logic | Allergy check uses a small demo drug list; fact sourcing is enforced only in the UI | High: clinical safety, not just security |

## 2. Scope and assets

**Assets to protect:** patient identity (ПИН), diagnoses and visit content (special-category health data), audio, transcripts, signed documents, doctor credentials and signing keys, audit logs, the LLM/API keys.

**Actors / threats to model:**
- External attacker (internet-facing web app, API, supply chain)
- Malicious or curious insider (clinic staff browsing patients they do not treat; operator staff)
- Compromised doctor device or account
- Compromised third party (speech provider, LLM provider, hosting, npm packages)
- Prompt injection through speech (patient or bystander says text that manipulates the extraction model)
- Model error presented as fact (clinical-safety threat: invented diagnosis, dose, or allergy miss)
- Loss of data / ransomware / availability attack on a clinic

**Out of scope until later:** clinic hardware, network, physical security (covered by an onboarding checklist, not by this codebase).

## 3. Governing requirements to confirm first (Phase 0)

⚖ Confirm with a lawyer and Минздрав, in writing:
1. Which Kyrgyz laws apply to health data and personal data processing (the law on personal data, health-care and e-health regulations, electronic signature law), and what registration/notification is needed.
2. **Data residency / cross-border transfer**: whether patient data, audio, and transcripts may leave Kyrgyzstan. This decides the whole architecture (see §5, Phase 1).
3. Requirements to connect through Tunduk (security server registration, the agreement with Минздрав, any mandatory security audit or certification of the connecting system).
4. Which ЭЦП scheme is legally accepted for medical documents and how doctors obtain keys.
5. Retention periods, patient consent wording, patient access/erasure rights.
6. Whether Минздрав or a state body must approve or audit the software (and who is allowed to audit it).

Choose the control framework once these are known. Proposed baseline (adjust to Минздрав requirements): **OWASP ASVS Level 2** (Level 3 for signing and record transfer), **OWASP Top 10**, **OWASP Top 10 for LLM Applications**, and ISO/IEC 27001 / 27799 as the management-system reference.

## 4. Phases

### Phase 0 — Governance and threat model (2–3 weeks)
- Appoint a security owner on the project and a data-protection contact.
- Written data-flow diagram of every place patient data goes (browser, speech provider, API, LLM, storage, Tunduk).
- STRIDE threat model per data flow; risk register with owners.
- Data classification: health data = highest class; define what may ever appear in logs (answer: no patient content, no ПИН).
- Decide hosting model (clinic on-prem, state cloud, or Kyrgyz data-centre) after §3 answers.
- Lawyer-reviewed consent text and privacy notice (replace the demo disclaimer footer).

### Phase 1 — Architecture decisions that cannot be bolted on later (3–6 weeks)
- **Speech recognition:** replace the browser Web Speech API with a self-hosted/on-prem ASR (or a provider inside the allowed jurisdiction under a processing agreement). No patient audio to unvetted third parties.
- **LLM:** either a model deployed in the allowed jurisdiction, or a provider under a signed data-processing agreement with zero-retention terms, de-identification before sending (strip name, ПИН, birth date, phone), and a documented decision by Минздрав. Until then the LLM feature stays disabled for real data.
- **Backend and storage:** real server with a database, encryption in transit (TLS 1.2+/HSTS) and at rest, per-clinic tenant isolation, backups, and a restore test.
- **Identity:** doctor login with strong authentication (MFA), short sessions, server-side authorization (RBAC: doctor, clinic admin, auditor), "treating relationship" check so a doctor sees only their patients, break-glass access with alerting.
- **Real ЭЦП:** integrate the nationally accepted signing mechanism (hardware token / certificate / mobile signing). The private key never touches our server or browser storage. Replace the SHA-256 demo.
- **Tunduk:** design the integration through the security server per the operator's spec; mutual TLS, signed messages, replay protection.
- **Audit log:** append-only, tamper-evident (hash chain or WORM storage), covering every read, write, sign, send, and doctor decision (kept / removed / edited), with who/when/what — and without storing medical content in the log itself.

### Phase 2 — Secure implementation (continuous, starts with Phase 1)
- Secure SDLC: branch protection, mandatory code review, signed commits for release, protected `main`.
- CI gates on every change: unit + integration tests, type-check, **SAST** (e.g. CodeQL / Semgrep), **dependency scan** (`npm audit`, Dependabot/Renovate), **secret scanning** (gitleaks), **SBOM** generation, lockfile verification; build only from CI, pin and review all new dependencies.
- **Web hardening:** Content-Security-Policy, HSTS, `X-Content-Type-Options`, frame-ancestors/clickjacking protection, strict CORS, CSRF protection, secure/HttpOnly/SameSite cookies, no health data in `localStorage`/URLs/logs.
- **API hardening:** authentication and authorization on every endpoint, schema validation, request size limits, rate limiting and per-user quotas (also protects the LLM key from abuse and cost attacks), consistent error messages without internals, no stack traces to clients.
- **Secrets:** move from `.env` to a secrets manager; rotation procedure; separate keys per environment; least-privilege API keys; alert on key leakage.
- **LLM-specific controls:** treat the transcript as untrusted input (prompt-injection tests), keep the existing server-side sanitizer (unknown sections and source IDs dropped, unsourced facts flagged), add output checks (no unsourced diagnosis/dose reaches a signed document without explicit doctor action), log model version and prompt version per document, pin model versions, and re-run the evaluation set before any model or prompt change.
- **Clinical-safety logic:** replace the demo allergy list with a maintained drug database; make "sign" impossible server-side (not only in the UI) while unreviewed unsourced facts or unresolved allergy conflicts exist; hazard analysis for the scribe workflow.

### Phase 3 — Verification (before any real data)
1. **Automated testing:** SAST/DAST (OWASP ZAP or equivalent) on a staging environment, dependency and container image scanning, IaC scanning.
2. **Threat-model-driven security tests** written by us: authorization matrix (every role × every endpoint), IDOR tests, session and MFA tests, tamper tests on the audit log, replay tests on signing and Tunduk messages.
3. **LLM red-teaming:** prompt injection through transcript text, attempts to make the model invent a diagnosis, dose or allergy-safe statement, attempts to exfiltrate the system prompt, extreme/garbage/multilingual input (Russian, Kyrgyz, mixed). Track a fixed regression set of transcripts with expected outputs.
4. **Independent penetration test** by an external accredited firm (web app, API, infrastructure, signing and Tunduk integration), with a re-test after fixes. Do not rely only on tests we wrote ourselves.
5. **Independent code review** of authentication, signing, audit log, and data-access layers.
6. **Privacy review / DPIA** (impact assessment) signed off by the data-protection contact and the lawyer.
7. **Resilience tests:** backup restore drill, failover, rate-limit/DoS behaviour, degraded mode (what the doctor can still do if ASR or the LLM is unavailable: documents must still be writable by hand).

### Phase 4 — Pilot with controls (one clinic, 2–3 months)
- Start with the lowest-risk document types and a small group of doctors; real data only after Phase 3 sign-off and legal approval.
- Written incident-response plan: detection, containment, notifying Минздрав and affected patients within the legally required time ⚖, contact tree, forensics, post-mortem.
- Security monitoring: centralized logs, alerts on mass record access, failed logins, signing anomalies, unusual LLM/ASR usage.
- Measure: minutes saved per visit, doctor edit rate on AI-generated facts, rate of unsourced facts, near-miss allergy catches. Stop criteria: any confirmed leak, any unsafe document signed because of a software fault.

### Phase 5 — Operate and re-certify
- Vulnerability management with SLAs (critical: 48 h, high: 7 days, medium: 30 days).
- Annual independent penetration test and after every major change (new integration, new model, new document type).
- Quarterly access reviews, key rotation, backup restore tests, tabletop incident exercise.
- Change control: every model, prompt, or drug-database update goes through the regression set before release.
- Staff training for clinic users (phishing, device hygiene, never sharing accounts).

## 5. Release gates (go / no-go)

Real patient data may be used only when **all** of these are true:
- [ ] Legal confirmation on data residency, consent, ЭЦП, and Tunduk terms (§3)
- [ ] Doctor authentication with MFA and server-side authorization in place
- [ ] Real ЭЦП integrated; demo signature removed
- [ ] Speech and LLM processing inside the approved jurisdiction or under signed agreements
- [ ] Data encrypted in transit and at rest; backups and restore tested
- [ ] Tamper-evident audit log live and reviewed
- [ ] No critical/high findings open from the independent penetration test and code review
- [ ] LLM red-team regression set passed; unsourced-fact and allergy blocks enforced server-side
- [ ] Incident-response plan tested
- [ ] Written sign-off by the security owner, data-protection contact, and Минздрав (or its designated body)

## 6. What can be done right now in this repository (no external parties needed)

Quick wins, in order:
1. Add CI (GitHub Actions): build, tests, `npm audit`, CodeQL, gitleaks; enable Dependabot and branch protection on `main`.
2. Add security headers and a strict Content-Security-Policy for the web app; add an auth token, request limits, and rate limiting to the local API server.
3. Move the sign/allergy/unsourced-fact rules into a shared module that a server will enforce, with tests (today they exist only in the UI).
4. Create a fixed LLM regression and prompt-injection test set (fictional transcripts) and a script that scores it.
5. Write the data-flow diagram and the risk register (Phase 0 deliverables) in `docs/`.
6. Replace the demo allergy table with a clearly-versioned data file and a documented source, and keep the "not a medical reference" warning until a real database is integrated.
7. Keep the repository private and keep all patient data in it fictional; add a pre-commit check that rejects anything that looks like a real ПИН or a key.

## 7. Who does what

| Work | Owner |
|---|---|
| Legal confirmations, consent text, Минздрав/Tunduk agreements | Project lead + lawyer |
| Architecture, secure coding, CI, tests, LLM evaluation | Development (Claude Code can do most of §6 and Phase 2) |
| Independent penetration test, independent code review | External accredited security firm |
| Clinical-safety review (allergy logic, document templates) | Practising physicians + pharmacist |
| Hosting, backups, monitoring, incident response | Operator (clinic IT or state/hosting partner) |
| Final approval | Минздрав / designated authority |

## 8. Suggested timeline

| Weeks | Milestone |
|---|---|
| 0–3 | Phase 0: legal answers, threat model, data-flow diagram, §6 quick wins |
| 3–10 | Phase 1–2: backend, auth, audit log, ЭЦП decision, ASR/LLM hosting decision |
| 10–14 | Phase 3: internal testing, LLM red-team, independent penetration test and fixes |
| 14–26 | Phase 4: controlled pilot in one clinic |
| 26+ | Phase 5: operate, re-test, expand |

These durations are estimates and depend mostly on the legal answers and on how quickly the ЭЦП and Tunduk access can be obtained.
