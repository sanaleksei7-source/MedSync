# MedSync — Cybersecurity Assurance Plan

Goal: bring MedSync from a fictional-data demo to a system that can be used with real patient data under the Ministry of Health (Минздрав) of the Kyrgyz Republic.

**Status of this document:** a plan, not a certification. Nothing here has been performed yet except the items marked ✅. Legal and regulatory statements marked ⚖ must be confirmed by a Kyrgyz lawyer and by Минздрав / the Tunduk operator; they are not legal advice.

---

## Progress tracker

**Last updated:** 2026-11-24 · **Overall:** Phase 0 in progress. No real-data release gate (§5) is met yet.

Legend: ✅ done · 🟡 partly done · ⬜ not started · 🚫 blocked (needs someone outside development)

### Phase summary

| Phase | Status | Done / total items | Notes |
|---|---|---|---|
| 0 — Governance and threat model | 🟡 In progress | 1 / 8 | Plan written; legal answers and threat model still missing |
| 1 — Architecture decisions | ⬜ Not started | 0 / 8 | Blocked by the Phase 0 legal answers (data residency, ЭЦП, Tunduk) |
| 2 — Secure implementation | 🟡 Started (partial) | 0 / 7 (3 partly) | A few controls exist from the demo build; no CI, no auth |
| 3 — Verification | ⬜ Not started | 0 / 7 | Needs a staging environment and Phase 1–2 output |
| 4 — Controlled pilot | ⬜ Not started | 0 / 3 | Only after the §5 gates |
| 5 — Operate and re-certify | ⬜ Not started | 0 / 5 | |

### Phase 0 — Governance and threat model
- ✅ Security plan written and committed (`SECURITY_PLAN.md`)
- ⬜ Appoint a security owner and a data-protection contact
- 🚫 Legal confirmations (§3): data residency, consent, ЭЦП scheme, Tunduk terms, retention, who may audit
- ⬜ Data-flow diagram of every place patient data goes
- ⬜ STRIDE threat model per data flow, and risk register with owners
- ⬜ Data classification and log policy (no patient content, no ПИН in logs)
- 🚫 Hosting model decision (depends on the legal answers)
- 🚫 Lawyer-reviewed consent text and privacy notice (the current footer is only a demo disclaimer)

### Phase 1 — Architecture decisions
- ⬜ Speech recognition inside the approved jurisdiction (replace the browser Web Speech API)
- ⬜ Language-model hosting or processing agreement, plus de-identification before sending
- ⬜ Backend and database with TLS, encryption at rest, tenant isolation, backups and a restore test
- ⬜ Doctor login with MFA
- ⬜ Server-side RBAC and "treating relationship" check; break-glass access with alerts
- 🚫 Real ЭЦП integration (replace the demo SHA-256 signature)
- 🚫 Tunduk integration design (mutual TLS, signed messages, replay protection)
- ⬜ Tamper-evident, persisted audit log (today only a UI change log exists)

### Phase 2 — Secure implementation
- ⬜ Secure SDLC: branch protection on `main`, mandatory review, signed releases
- ⬜ CI gates: tests, type-check, SAST, dependency scan, secret scan, SBOM
- ⬜ Web hardening: CSP, HSTS, frame protection, CORS, CSRF, cookies
- 🟡 API hardening — done: request validation, 1 MB body limit, 400-line limit, refuses to run without a key, no internals in error messages. Missing: authentication, authorization, rate limiting, per-user quotas
- 🟡 Secrets — done: `.env` is gitignored, `.env.example` committed, key never reaches the browser. Missing: secrets manager, rotation, separate keys per environment
- 🟡 LLM-specific controls — done: server-side sanitizer (unknown sections and source IDs dropped, unsourced facts kept and flagged), prompt tells the model to treat the transcript as data, extraction test. Missing: output checks before signing, model/prompt version logging, red-team regression set
- 🟡 Clinical-safety logic — done: signing blocked in the UI on unreviewed unsourced facts and on unresolved allergy conflicts (demo drug list). Missing: server-side enforcement, real drug database, hazard analysis

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
- Tests passing: ПИН format (`npm test`), model-output sanitizer (`npm test`)
- Not yet verified: the extraction call to the real model has never run (no API key available to development)

### Changelog
| Date | Change |
|---|---|
| 2026-11-24 | Plan written; progress tracker added; Phase 0 started |

How this tracker is maintained: whenever a security task lands, its line above changes status, the counts in the phase summary are updated, the evidence list gets what was checked and how, and a row is added to the changelog.

---

## 1. Honest current state (as of commit `abda24a`)

MedSync today is a **demo**. It must not be used with real patient data.

| Area | Current state | Risk if used for real |
|---|---|---|
| Authentication / roles | None. Anyone who opens the page is "the doctor" | Critical |
| Data storage | Browser `localStorage` only (history); no database | Critical (no backup, no audit, no access control) |
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
