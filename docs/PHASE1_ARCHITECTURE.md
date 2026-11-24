# Phase 1 — Architecture status and decision records

Companion to `SECURITY_PLAN.md`. Everything here uses **fictional data only**. Items marked ⚖ depend on legal answers from Phase 0; nothing below has been independently reviewed or penetration-tested.

## 1. What is built (prototype)

| Control | Where | How it works | Tested |
|---|---|---|---|
| Passwords | `server/auth.ts` | scrypt with a random 16-byte salt, constant-time comparison, minimum length 12 | 5 unit checks |
| Second factor | `server/auth.ts` | TOTP (RFC 6238, SHA-1, 6 digits, ±1 step), checked against the RFC test vector | 5 unit checks |
| Login lockout | `server/auth.ts`, `server/app.ts` | 5 failures per username per 15 min locks that account even for correct credentials; 20 login requests/min per address | unit + integration |
| Sessions | `server/auth.ts` | 256-bit random token in an `HttpOnly; SameSite=Strict` cookie; only the SHA-256 of the token is stored on the server; 15 min idle, 8 h absolute; logout ends only that session | unit + integration |
| CSRF / cross-site | `server/app.ts`, `server/guards.ts` | Origin allow-list, Host allow-list, JSON-only content type, required `X-Requested-With` header on POST | integration |
| Account enumeration | `server/app.ts` | same status and message for unknown user, wrong password and wrong code; a dummy hash is verified for unknown users | integration |
| Roles and access | `server/rbac.ts` | `doctor`, `admin`, `auditor`; a doctor reaches only patients assigned to them; admin and auditor see no patient data | 10 unit + integration |
| Server-side sign rules | `server/app.ts`, `src/domain/rules.ts` | the server recomputes allergy conflicts from the transcript and re-checks unsourced facts; the client cannot claim "reviewed" | integration |
| Audit log | `server/audit.ts` | append-only JSON Lines, each record includes the previous record's hash; editing, removing, reordering or truncating is detected; stores ids, action types and document hashes only — no medical text, names or ПИН | 9 unit + integration |
| Signer interface | `server/signer.ts` | signing sits behind an interface; the current `DemoSigner` is an HMAC and is **not** an ЭЦП | integration |

Run `npm test` (all tests), `npm run seed` (creates fictional users in the gitignored `data/` folder), `npm run server`, and `npm run smoke` (live check of the running server).

## 2. Known limitations of the prototype (must be closed before real use)

1. **Drafts are held by the client.** The server verifies the rules on what the client sends, but the text being signed comes from the client. Real design: the server stores the draft, the doctor's decisions and the transcript, and signs only what it holds.
2. **Patient data still ships in the web bundle.** The patient list and the allergy table are static fictional data in `src/data/`. Real design: patients come from the server after an access check, and every read is audited.
3. **History is in the browser** (`localStorage`). Real design: stored server-side per clinic with access control.
4. **Storage is JSON files** (`data/users.json`, `data/audit.log`). Real design: a database with encryption at rest, backups, restore tests and per-clinic isolation. The audit log should also be shipped to write-once storage, because a local file can be replaced wholesale together with its chain.
5. **Sessions live in memory** and are lost on restart; no multi-instance support.
6. **No password change, reset, user management or MFA enrolment flow.** Users and secrets are created by a script.
7. **Break-glass access** (emergency access to a patient not assigned to the doctor, with alerting) is not built.
8. **Transport security** (TLS, HSTS, secure cookie flag) depends on the hosting; the code sets `Secure` only when `NODE_ENV=production`.
9. **Audit log retention and who may read it** are undefined (⚖).
10. **The authentication code has had no independent review.** Home-grown authentication is a risk in itself; a state identity service or a vetted identity provider may be the better choice (see D6).

## 3. Decision records (pending)

Each record lists the options, a recommended default, and what unblocks it. Nothing here is decided.

### D1 — Speech recognition ⚖
- **Now:** browser Web Speech API; in Chrome and Edge the audio goes to Google or Microsoft.
- **Options:** (a) self-hosted open-source model on infrastructure inside the approved jurisdiction; (b) a provider inside the jurisdiction under a processing agreement; (c) keep the browser API for fictional-data demos only.
- **Recommended:** (a) for pilot, because it removes a foreign processor. Needs a Russian and Kyrgyz accuracy test on real clinic audio before choosing the model.
- **Blocked by:** whether audio may leave the country; hosting decision (D5); GPU capacity.

### D2 — Language model for fact extraction ⚖
- **Now:** Anthropic API (Claude) through the local server, fictional data only.
- **Options:** (a) a provider under a signed data-processing agreement with zero-retention terms and de-identification before sending (strip name, ПИН, birth date, phone); (b) a model hosted inside the jurisdiction; (c) disable extraction for real data and let doctors type.
- **Recommended:** keep extraction disabled for real data until the lawyer confirms the transfer rules; design de-identification now so either (a) or (b) fits.
- **Blocked by:** legal answer on cross-border transfer; the vendor agreement; a decision on who bears the liability for model errors.

### D3 — Electronic signature (ЭЦП) ⚖
- **Now:** `DemoSigner` (HMAC, no legal force).
- **Options:** (a) the national scheme issued to doctors (token or certificate) with signing on the doctor's device; (b) a mobile signature service; (c) server-side signing with a qualified key (usually not acceptable for personal signatures).
- **Recommended:** implement the `Signer` interface against whichever scheme Минздрав accepts; the private key must never be stored in the browser or on our server.
- **Blocked by:** which scheme is legally accepted for medical documents and how doctors obtain keys.

### D4 — Tunduk and the medical record ⚖
- **Now:** "send to record" is a simulation.
- **Plan:** the connection goes through the operator's security server using mutual TLS and signed messages, with replay protection. The exact protocol and data formats come from the operator.
- **Blocked by:** the agreement with Минздрав, registration of the system as a participant, the format of the document the record accepts.

### D5 — Hosting ⚖
- **Options:** clinic on-premises; state cloud or in-country data centre; a commercial in-country provider.
- **Recommended:** decide after the residency answer; prefer an in-country environment you control, with encryption at rest and tested backups. Production needs TLS, HSTS and `frame-ancestors` set at the web server.

### D6 — Identity
- **Now:** own users, passwords and TOTP.
- **Options:** (a) keep own accounts (needs a review and the missing flows from section 2); (b) integrate a state or clinic identity provider if one exists and may be used.
- **Recommended:** ask Минздрав whether a national identity service is available; if yes, prefer it and keep only role and patient assignment locally.

### D7 — Data storage
- **Options:** PostgreSQL in the chosen environment (encryption at rest, row-level access checks, point-in-time recovery).
- **Recommended:** PostgreSQL once D5 is decided; migrate users, drafts, signed documents and audit anchors; test restore before the pilot.

## 4. Suggested order of work

1. Server-held drafts and server-side history (closes limitations 1–3).
2. Database and migrations once D5 and D7 are decided.
3. Account management and MFA enrolment, plus break-glass access with alerts.
4. Independent review of the authentication, sign and audit code (Phase 3).
5. ASR, model, ЭЦП and Tunduk integrations as the legal answers arrive.
