// Интеграционный тест: весь сервер в одном процессе, без реальной модели и без ключа API.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHandler, type UserRecord } from "./app";
import { LoginThrottle, SessionStore, hashPassword, newTotpSecret, totpAt } from "./auth";
import { verifyChain, type AuditRecord } from "./audit";
import { DemoSigner } from "./signer";
import type { AsrEngine } from "./asr/engine";

const secrets = { doc: newTotpSecret(), doc2: newTotpSecret(), adm: newTotpSecret(), aud: newTotpSecret() };
const pw = "test-password-123";
const hash = await hashPassword(pw);
const mkUser = (id: string, role: UserRecord["role"], totpSecret: string, assigned: string[]): UserRecord => ({
  id, username: id, name: id, role, passwordHash: hash, totpSecret, assignedPatients: assigned,
});
const users = [
  mkUser("doc1", "doctor", secrets.doc, ["p1", "p2"]),
  mkUser("doc2", "doctor", secrets.doc2, ["p3"]),
  mkUser("adm1", "admin", secrets.adm, []),
  mkUser("aud1", "auditor", secrets.aud, []),
];
const audit: AuditRecord[] = [];
let extractCalls = 0;

const sessions = new SessionStore();
const throttle = new LoginThrottle(5, 60_000);
const server = http.createServer();
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as AddressInfo).port;
let asrCalls = 0;
let asrBehavior: () => Promise<string> = async () => "Температура тридцать семь и восемь.";
const fakeAsr: AsrEngine = { name: "fake", transcribe: async () => { asrCalls++; return asrBehavior(); } };
const deps: Parameters<typeof createHandler>[0] = {
  users,
  asr: fakeAsr,
  ipLimitPerMinute: 100_000,
  sessions,
  throttle,
  signer: new DemoSigner("test-key"),
  audit,
  persistAudit: () => {},
  extract: async () => { extractCalls++; return [{ title: "Жалобы", statements: [{ text: "x", sourceIds: [1] }] }]; },
  allowedOrigins: ["http://localhost:5173"],
  allowedHosts: [`127.0.0.1:${port}`],
  secureCookie: false,
  dummyHash: hash,
};
const handler = createHandler(deps);
server.on("request", (req, res) => void handler(req, res));

const base = `http://127.0.0.1:${port}`;
type R = { status: number; body: any; cookie?: string };
async function call(method: string, path: string, opts: { body?: unknown; cookie?: string; origin?: string; xrw?: boolean; ct?: string } = {}): Promise<R> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = opts.ct ?? "application/json";
  if (opts.xrw !== false && method === "POST") headers["X-Requested-With"] = "medsync";
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.origin) headers.Origin = opts.origin;
  const r = await fetch(base + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const setCookie = r.headers.get("set-cookie") ?? undefined;
  return { status: r.status, body: await r.json().catch(() => null), cookie: setCookie };
}
async function callRaw(path: string, bytes: Buffer, opts: { cookie?: string; rate?: string; ct?: string } = {}): Promise<R> {
  const headers: Record<string, string> = { "Content-Type": opts.ct ?? "application/octet-stream", "X-Requested-With": "medsync", "X-Sample-Rate": opts.rate ?? "16000" };
  if (opts.cookie) headers.Cookie = opts.cookie;
  const r = await fetch(base + path, { method: "POST", headers, body: new Uint8Array(bytes) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const pcmBytes = (seconds: number, amp: number) =>
  Buffer.from(Int16Array.from({ length: Math.round(seconds * 16000) }, (_, i) => Math.round(Math.sin(i / 8) * amp)).buffer);
const code = (s: string) => totpAt(s, Date.now());
async function login(user: string, secret: string): Promise<string> {
  const r = await call("POST", "/api/login", { body: { username: user, password: pw, code: code(secret) } });
  if (r.status !== 200 || !r.cookie) throw new Error(`login failed for ${user}: ${r.status}`);
  return r.cookie.split(";")[0];
}

const t: [string, boolean][] = [];
const check = (name: string, ok: boolean) => t.push([name, ok]);

// --- без входа ---
check("no session → 401", (await call("GET", "/api/me")).status === 401);
check("sign without session → 401", (await call("POST", "/api/sign", { body: {} })).status === 401);

// --- вход ---
check("wrong password → 401", (await call("POST", "/api/login", { body: { username: "doc1", password: "wrong-password-1", code: code(secrets.doc) } })).status === 401);
check("wrong code → 401", (await call("POST", "/api/login", { body: { username: "doc1", password: pw, code: "000000" } })).status === 401);
const unknown = await call("POST", "/api/login", { body: { username: "nobody", password: pw, code: "123456" } });
const wrongPw = await call("POST", "/api/login", { body: { username: "doc1", password: "wrong-password-1", code: code(secrets.doc) } });
check("same error for unknown user and wrong password", unknown.status === wrongPw.status && unknown.body.error === wrongPw.body.error);
const ok = await call("POST", "/api/login", { body: { username: "doc1", password: pw, code: code(secrets.doc) } });
check("login ok → 200", ok.status === 200 && ok.body.role === "doctor");
check("cookie is HttpOnly + SameSite=Strict", /HttpOnly/.test(ok.cookie ?? "") && /SameSite=Strict/.test(ok.cookie ?? ""));
check("response has no password hash or totp secret", !JSON.stringify(ok.body).includes("scrypt") && !JSON.stringify(ok.body).includes(secrets.doc));

const doc = await login("doc1", secrets.doc);
check("/api/me with cookie", (await call("GET", "/api/me", { cookie: doc })).body?.id === "doc1");
check("garbage cookie → 401", (await call("GET", "/api/me", { cookie: "medsync_session=garbage" })).status === 401);

// --- CSRF/Origin ---
check("POST without X-Requested-With → 403", (await call("POST", "/api/extract", { cookie: doc, body: {}, xrw: false })).status === 403);
check("foreign Origin → 403", (await call("GET", "/api/me", { cookie: doc, origin: "https://evil.example" })).status === 403);
check("form content type → 415", (await call("POST", "/api/extract", { cookie: doc, body: {}, ct: "application/x-www-form-urlencoded" })).status === 415);

// --- извлечение ---
const lines = [
  { id: 1, speaker: "Пациент", text: "Болит горло." },
  { id: 14, speaker: "Врач", text: "Добавим амоксициллин, по 500 миллиграммов." },
];
const ex = await call("POST", "/api/extract", { cookie: doc, body: { docTitle: "Справка", sectionTitles: ["Жалобы"], lines } });
check("doctor can extract", ex.status === 200 && extractCalls === 1);
const adm = await login("adm1", secrets.adm);
check("admin cannot extract", (await call("POST", "/api/extract", { cookie: adm, body: { docTitle: "Справка", sectionTitles: ["Жалобы"], lines } })).status === 403);
check("malformed extract body → 400", (await call("POST", "/api/extract", { cookie: doc, body: { docTitle: "x", sectionTitles: [], lines: [] } })).status === 400);

// --- подпись ---
const sections = [
  { title: "Жалобы", statements: [{ text: "Боль в горле.", sourceIds: [1] }] },
  { title: "Диагноз", statements: [{ text: "ОРВИ", sourceIds: [] }] },
  { title: "Назначения", statements: [{ text: "Амоксициллин 500 мг", sourceIds: [14] }] },
];
const signBody = (over: object) => ({ patientId: "p1", docType: "Осмотр", lines, sections, decisions: {}, ackAllergy: [], ...over });
const s1 = await call("POST", "/api/sign", { cookie: doc, body: signBody({}) });
check("sign blocked: unchecked fact + allergy → 409", s1.status === 409 && s1.body.blockers.unchecked.length === 1 && s1.body.blockers.allergy.length === 1);
const s2 = await call("POST", "/api/sign", { cookie: doc, body: signBody({ decisions: { "1-0": { action: "kept" } } }) });
check("still blocked by allergy → 409", s2.status === 409 && s2.body.blockers.unchecked.length === 0 && s2.body.blockers.allergy.length === 1);
check("client cannot claim 'checked' by wrong key", (await call("POST", "/api/sign", { cookie: doc, body: signBody({ decisions: { "9-9": { action: "kept" } } }) })).status === 409);
const s3 = await call("POST", "/api/sign", { cookie: doc, body: signBody({ decisions: { "1-0": { action: "kept" }, "2-0": { action: "removed" } } }) });
check("signed after removing the order → 200", s3.status === 200 && /^[0-9a-f]{64}$/.test(s3.body.hash) && s3.body.demo === true);
const s4 = await call("POST", "/api/sign", { cookie: doc, body: signBody({ decisions: { "1-0": { action: "kept" } }, ackAllergy: [14] }) });
check("signed after doctor acknowledges allergy → 200", s4.status === 200);
check("different content → different hash", s3.body.hash !== s4.body.hash);
check("other doctor's patient → 403", (await call("POST", "/api/sign", { cookie: doc, body: signBody({ patientId: "p3" }) })).status === 403);
const doc2 = await login("doc2", secrets.doc2);
check("doctor2 cannot sign doctor1's patient", (await call("POST", "/api/sign", { cookie: doc2, body: signBody({ decisions: { "1-0": { action: "kept" }, "2-0": { action: "removed" } } }) })).status === 403);
check("admin cannot sign", (await call("POST", "/api/sign", { cookie: adm, body: signBody({}) })).status === 403);
check("unknown patient → 403 (not in assignments)", (await call("POST", "/api/sign", { cookie: doc, body: signBody({ patientId: "p99" }) })).status === 403);

// --- распознавание речи ---
const speech = pcmBytes(1.5, 8000);
check("asr without session → 401", (await callRaw("/api/asr", speech)).status === 401);
check("admin cannot use asr", (await callRaw("/api/asr", speech, { cookie: adm })).status === 403);
check("asr rejects json content type → 415", (await callRaw("/api/asr", speech, { cookie: doc, ct: "application/json" })).status === 415);
check("extract rejects audio content type → 415", (await callRaw("/api/extract", speech, { cookie: doc })).status === 415);
check("asr wrong sample rate → 400", (await callRaw("/api/asr", speech, { cookie: doc, rate: "44100" })).status === 400);
check("asr odd byte length → 400", (await callRaw("/api/asr", speech.subarray(0, speech.length - 1), { cookie: doc })).status === 400);
check("asr too short → 400", (await callRaw("/api/asr", pcmBytes(0.1, 8000), { cookie: doc })).status === 400);
check("asr too long → rejected", [400, 413].includes((await callRaw("/api/asr", pcmBytes(31, 8000), { cookie: doc })).status));
const before = asrCalls;
const sil = await callRaw("/api/asr", pcmBytes(1.5, 0), { cookie: doc });
check("silence is dropped without calling the engine", sil.status === 200 && sil.body.dropped === "silence" && asrCalls === before);
const ok1 = await callRaw("/api/asr", speech, { cookie: doc });
check("speech is transcribed by the engine", ok1.status === 200 && ok1.body.text === "Температура тридцать семь и восемь." && asrCalls === before + 1);
asrBehavior = async () => "Продолжение следует...";
const hal = await callRaw("/api/asr", speech, { cookie: doc });
check("hallucination is dropped", hal.status === 200 && hal.body.text === "" && hal.body.dropped === "hallucination");
asrBehavior = async () => { throw new Error("SECRET internal detail"); };
const boom = await callRaw("/api/asr", speech, { cookie: doc });
check("engine failure → 502 without details", boom.status === 502 && !JSON.stringify(boom.body).includes("SECRET"));
asrBehavior = async () => "Температура тридцать семь и восемь.";
deps.asr = null;
check("asr not configured → 503", (await callRaw("/api/asr", speech, { cookie: doc })).status === 503);
deps.asr = fakeAsr;
const segLogs = audit.filter((r) => r.action === "asr.segment");
check("asr segments audited with duration only", segLogs.length >= 3 && segLogs.every((r) => Object.keys(r.detail ?? {}).join() === "seconds"));
check("transcribed text never reaches the audit log", !JSON.stringify(audit).includes("тридцать семь и восемь"));
let limited = 0;
for (let i = 0; i < 70; i++) if ((await callRaw("/api/asr", pcmBytes(0.5, 0), { cookie: doc2 })).status === 429) limited++;
check("asr is rate limited per user", limited >= 5);

// --- журнал аудита ---
const aud = await login("aud1", secrets.aud);
const v = await call("GET", "/api/audit/verify", { cookie: aud });
check("auditor verifies untouched chain", v.status === 200 && v.body.ok === true && v.body.count > 5);
check("doctor cannot verify audit", (await call("GET", "/api/audit/verify", { cookie: doc })).status === 403);
const dump = JSON.stringify(audit);
check("audit has no medical text, names or ПИН", !dump.includes("ОРВИ") && !dump.includes("Боль в горле") && !dump.includes("Иванова") && !/\d{14}/.test(dump.replace(/[0-9a-f]{64}/g, "")));
check("audit records failed logins and denied signing", audit.some((r) => r.action === "login.fail") && audit.some((r) => r.action === "document.sign.denied") && audit.some((r) => r.action === "document.sign.blocked"));
audit[3].actor = "tampered";
const v2 = await call("GET", "/api/audit/verify", { cookie: aud });
check("tampered audit detected over API", v2.status === 200 && v2.body.ok === false);
check("chain check agrees", !verifyChain(audit).ok);

// --- выход ---
const lo = await call("POST", "/api/logout", { cookie: doc, body: {} });
check("logout ok", lo.status === 200);
check("session dead after logout", (await call("GET", "/api/me", { cookie: doc })).status === 401);
check("logout does not end other sessions", (await call("GET", "/api/me", { cookie: doc2 })).status === 200);

// --- блокировка перебора ---
for (let i = 0; i < 5; i++) await call("POST", "/api/login", { body: { username: "adm1", password: "wrong-password-1", code: "000000" } });
const locked = await call("POST", "/api/login", { body: { username: "adm1", password: pw, code: code(secrets.adm) } });
check("account locked after 5 failures, even with right credentials", locked.status === 429);

let bad = 0;
for (const [n, passed] of t) if (!passed) { bad++; console.error("FAIL", n); }
console.log(bad ? `BAD app (${bad}/${t.length})` : `ok app (${t.length})`);
server.close();
process.exit(bad ? 1 : 0);
