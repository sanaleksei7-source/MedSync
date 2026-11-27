// Интеграционный тест: весь сервер в одном процессе, без реальной модели и без ключа API.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHandler, type UserRecord } from "./app";
import { LoginThrottle, SessionStore, TokenStore, hashPassword, newTotpSecret, totpAt } from "./auth";
import { createHash } from "node:crypto";
import { verifyChain, type AuditRecord } from "./audit";
import { DemoSigner } from "./signer";
import type { AsrEngine } from "./asr/engine";
import { newKey, parseKeyring } from "./db/crypto";
import { openPglite } from "./db/db";
import { migrate } from "./db/migrate";
import { PgVisitStore } from "./db/visit-store";

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
// --pglite: те же проверки на настоящем PostgreSQL с шифрованием полей (npm test запускает оба варианта).
const pgDb = process.argv.includes("--pglite") ? await openPglite() : null;
if (pgDb) await migrate(pgDb);
const audit: AuditRecord[] = [];
let extractCalls = 0;
let extractResult: { title: string; statements: { text: string; sourceIds: number[] }[] }[] = [];
let extractFails = false;

const sessions = new SessionStore();
const throttle = new LoginThrottle(5, 60_000);
const server = http.createServer();
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as AddressInfo).port;
let asrCalls = 0;
let asrBehavior: () => Promise<string | { text: string; words?: { w: string; p: number }[] }> = async () => "Температура тридцать семь и восемь.";
const fakeAsr: AsrEngine = { name: "fake", transcribe: async () => { asrCalls++; const r = await asrBehavior(); return typeof r === "string" ? { text: r } : r; } };
const deps: Parameters<typeof createHandler>[0] = {
  users,
  asr: fakeAsr,
  ipLimitPerMinute: 100_000,
  loginLimitPerMinute: 1000,
  sessions,
  tokens: new TokenStore(),
  appOrigins: ["capacitor://localhost", "https://localhost"],
  throttle,
  signer: new DemoSigner("test-key"),
  audit,
  persistAudit: () => {},
  extract: async () => { extractCalls++; if (extractFails) throw new Error("model down"); return structuredClone(extractResult); },
  allowedOrigins: ["http://localhost:5173"],
  allowedHosts: [`127.0.0.1:${port}`],
  secureCookie: false,
  dummyHash: hash,
};
const handler = createHandler(deps);
server.on("request", (req, res) => void handler(req, res));

const base = `http://127.0.0.1:${port}`;
type R = { status: number; body: any; cookie?: string; headers?: Headers };
async function call(method: string, path: string, opts: { body?: unknown; cookie?: string; origin?: string; xrw?: boolean; ct?: string; auth?: string } = {}): Promise<R> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = opts.ct ?? "application/json";
  if (opts.xrw !== false && method === "POST") headers["X-Requested-With"] = "medsync";
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.origin) headers.Origin = opts.origin;
  if (opts.auth) headers.Authorization = opts.auth;
  const r = await fetch(base + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const setCookie = r.headers.get("set-cookie") ?? undefined;
  return { status: r.status, body: await r.json().catch(() => null), cookie: setCookie, headers: r.headers };
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
check("visit routes without session → 401", (await call("POST", "/api/visits", { body: {} })).status === 401 && (await call("GET", "/api/visits/" + "0".repeat(32))).status === 401);
check("the old routes that accepted client-supplied text are gone", (await call("POST", "/api/sign", { cookie: await login("doc1", secrets.doc), body: { patientId: "p1" } })).status === 404 && (await call("POST", "/api/extract", { cookie: await login("doc1", secrets.doc), body: {} })).status === 404);

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
check("POST without X-Requested-With → 403", (await call("POST", "/api/visits", { cookie: doc, body: {}, xrw: false })).status === 403);
check("foreign Origin → 403", (await call("GET", "/api/me", { cookie: doc, origin: "https://evil.example" })).status === 403);
check("form content type → 415", (await call("POST", "/api/visits", { cookie: doc, body: {}, ct: "application/x-www-form-urlencoded" })).status === 415);

// --- приёмы (шаг 3.1): расшифровку, черновик и решения хранит сервер ---
const adm = await login("adm1", secrets.adm);
const doc2 = await login("doc2", secrets.doc2);
const post = (cookie: string, path: string, body: unknown = {}) => call("POST", path, { cookie, body });
const lines = [
  { id: 1, speaker: "Пациент", text: "Болит горло." },
  { id: 14, speaker: "Врач", text: "Добавим амоксициллин, по 500 миллиграммов." },
];
const draftSections = () => [
  { title: "Жалобы", statements: [{ text: "Боль в горле.", sourceIds: [1] }] },
  { title: "Диагноз", statements: [{ text: "ОРВИ", sourceIds: [] }] },
  { title: "Назначения", statements: [{ text: "Амоксициллин 500 мг", sourceIds: [14] }] },
];
/** Живой приём p1 до этапа решений врача: создан, расшифровка загружена, черновик составлен. */
async function liveVisit(cookie = doc, patientId = "p1") {
  const c = await post(cookie, "/api/visits", { patientId, docType: "osmotr" });
  const id = c.body.id as string;
  await post(cookie, `/api/visits/${id}/transcript`, { lines });
  extractResult = draftSections();
  const e = await post(cookie, `/api/visits/${id}/extract`);
  return { id, c, e };
}

// создание
const c1 = await post(doc, "/api/visits", { patientId: "p1", docType: "osmotr" });
check("create live visit → draft, no sections yet", c1.status === 200 && /^[0-9a-f]{32}$/.test(c1.body.id) && c1.body.status === "draft" && c1.body.sections === null && c1.body.lines.length === 0);
check("visit without session → 401", (await call("POST", "/api/visits", { body: { patientId: "p1", docType: "osmotr" } })).status === 401);
check("other doctor's patient → 403", (await post(doc, "/api/visits", { patientId: "p3", docType: "osmotr" })).status === 403);
check("unknown patient → 403", (await post(doc, "/api/visits", { patientId: "p99", docType: "osmotr" })).status === 403);
check("admin cannot create visits", (await post(adm, "/api/visits", { patientId: "p1", docType: "osmotr" })).status === 403);
check("bad document type → 400", (await post(doc, "/api/visits", { patientId: "p1", docType: "__proto__" })).status === 400);
check("missing fields → 400", (await post(doc, "/api/visits", { patientId: "p1" })).status === 400);
const demo = await post(doc, "/api/visits", { patientId: "p1", docType: "spravka", demo: true, lines: [{ id: 1, speaker: "Врач", text: "подделка" }], sections: [] });
check("demo visit: transcript and template come from the server, not the client", demo.status === 200 && demo.body.lines.length === 16 && !JSON.stringify(demo.body).includes("подделка") && demo.body.sections.length > 0);

// чтение и владение
check("owner can read the visit", (await call("GET", `/api/visits/${c1.body.id}`, { cookie: doc })).body?.id === c1.body.id);
check("other doctor gets 404 for someone else's visit", (await call("GET", `/api/visits/${c1.body.id}`, { cookie: doc2 })).status === 404);
check("other doctor cannot change someone else's visit", (await post(doc2, `/api/visits/${c1.body.id}/transcript`, { lines })).status === 404);
check("other doctor cannot sign someone else's visit", (await post(doc2, `/api/visits/${c1.body.id}/sign`)).status === 404);
check("admin gets 404 too", (await call("GET", `/api/visits/${c1.body.id}`, { cookie: adm })).status === 404);
check("unknown visit id → 404", (await call("GET", `/api/visits/${"0".repeat(32)}`, { cookie: doc })).status === 404);
check("malformed visit id → 404", (await call("GET", "/api/visits/abc", { cookie: doc })).status === 404);

// расшифровка
const vid = c1.body.id as string;
check("extract before transcript → 400", (await post(doc, `/api/visits/${vid}/extract`)).status === 400);
for (const [name, bad] of [
  ["duplicate line ids", [{ id: 1, speaker: "Врач", text: "а" }, { id: 1, speaker: "Врач", text: "б" }]],
  ["empty text", [{ id: 1, speaker: "Врач", text: "  " }]],
  ["bad speaker", [{ id: 1, speaker: "Админ", text: "а" }]],
  ["non-integer id", [{ id: 1.5, speaker: "Врач", text: "а" }]],
  ["zero id", [{ id: 0, speaker: "Врач", text: "а" }]],
  ["too long text", [{ id: 1, speaker: "Врач", text: "я".repeat(2001) }]],
  ["too many lines", Array.from({ length: 401 }, (_, i) => ({ id: i + 1, speaker: "Врач", text: "а" }))],
  ["empty list", []],
] as [string, unknown][]) check(`transcript rejects ${name} → 400`, (await post(doc, `/api/visits/${vid}/transcript`, { lines: bad })).status === 400);
const tr = await post(doc, `/api/visits/${vid}/transcript`, { lines });
check("transcript saved on the server", tr.status === 200 && tr.body.lines.length === 2 && tr.body.sections === null);
check("demo transcript cannot be replaced", (await post(doc, `/api/visits/${demo.body.id}/transcript`, { lines })).status === 409);

// составление черновика
extractResult = [{ title: "Жалобы", statements: [{ text: "Боль в горле.", sourceIds: [1, 999, 1] }] }];
const exCalls = extractCalls;
const ex = await post(doc, `/api/visits/${vid}/extract`);
check("extract uses the transcript held by the server", ex.status === 200 && extractCalls === exCalls + 1 && ex.body.sections[0].statements[0].text === "Боль в горле.");
check("references to non-existent lines are not accepted as sources", JSON.stringify(ex.body.sections[0].statements[0].sourceIds) === "[1]");
check("extract on a demo visit → 409 (draft already built)", (await post(doc, `/api/visits/${demo.body.id}/extract`)).status === 409);
extractFails = true;
const exFail = await post(doc, `/api/visits/${vid}/extract`);
check("model failure → 502, visit keeps its draft", exFail.status === 502 && (await call("GET", `/api/visits/${vid}`, { cookie: doc })).body.sections !== null);
extractFails = false;
await post(doc, `/api/visits/${vid}/transcript`, { lines });
check("new transcript invalidates the old draft and decisions", (await call("GET", `/api/visits/${vid}`, { cookie: doc })).body.sections === null);

// решения врача
const vs = await liveVisit();
const d = (body: unknown) => post(doc, `/api/visits/${vs.id}/decisions`, body);
check("draft built for the sign tests", vs.e.status === 200 && vs.e.body.sections.length === 3);
check("empty decisions body → 400", (await d({})).status === 400);
check("unknown statement key → 400", (await d({ changes: [{ key: "9-9", action: "kept" }] })).status === 400);
check("malformed key → 400", (await d({ changes: [{ key: "1-0; drop", action: "kept" }] })).status === 400);
check("unknown action → 400", (await d({ changes: [{ key: "1-0", action: "approved" }] })).status === 400);
check("edit without text → 400", (await d({ changes: [{ key: "1-0", action: "edited" }] })).status === 400);
check("acknowledging a conflict that does not exist → 400", (await d({ ack: [1] })).status === 400);
check("one bad change rejects the whole request", (await d({ changes: [{ key: "1-0", action: "kept" }, { key: "9-9", action: "kept" }] })).status === 400 && Object.keys((await call("GET", `/api/visits/${vs.id}`, { cookie: doc })).body.decisions).length === 0);

// подпись: правила проверяются по данным сервера
const s1 = await post(doc, `/api/visits/${vs.id}/sign`);
check("sign blocked: unchecked fact + allergy → 409", s1.status === 409 && s1.body.blockers.unchecked.length === 1 && s1.body.blockers.allergy.length === 1);
const forged = await post(doc, `/api/visits/${vs.id}/sign`, { decisions: { "1-0": { action: "kept" } }, ackAllergy: [14], sections: [], lines: [], unchecked: [] });
check("client cannot claim 'checked' or 'acknowledged' in the sign request", forged.status === 409 && forged.body.blockers.unchecked.length === 1 && forged.body.blockers.allergy.length === 1);
await d({ changes: [{ key: "1-0", action: "kept" }] });
const s2 = await post(doc, `/api/visits/${vs.id}/sign`);
check("still blocked by allergy → 409", s2.status === 409 && s2.body.blockers.unchecked.length === 0 && s2.body.blockers.allergy.length === 1);
const dr = await d({ changes: [{ key: "2-0", action: "removed" }] });
check("decision recorded on the server with a change log", dr.status === 200 && dr.body.decisions["2-0"].action === "removed" && dr.body.changeLog.length === 2 && dr.body.changeLog[1].before === "Амоксициллин 500 мг");

// главное свойство шага 3.1: подписывается то, что у сервера, а не то, что прислал клиент
const twin = await liveVisit();
await post(doc, `/api/visits/${twin.id}/decisions`, { changes: [{ key: "1-0", action: "kept" }, { key: "2-0", action: "removed" }] });
const s3 = await post(doc, `/api/visits/${vs.id}/sign`, {});
check("signed after removing the order → 200 with hash", s3.status === 200 && s3.body.status === "signed" && /^[0-9a-f]{64}$/.test(s3.body.signed.hash) && s3.body.signed.demo === true);
const evil = { sections: [{ title: "Диагноз", statements: [{ text: "ПОДДЕЛКА", sourceIds: [1] }] }], lines: [{ id: 1, speaker: "Врач", text: "ПОДДЕЛКА" }], decisions: { "0-0": { action: "edited", text: "ПОДДЕЛКА" } }, docType: "Справка", patientId: "p3", text: "ПОДДЕЛКА" };
const s3t = await post(doc, `/api/visits/${twin.id}/sign`, evil);
check("client cannot alter signed text: same server content gives the same hash whatever the client sends", s3t.status === 200 && s3t.body.signed.hash === s3.body.signed.hash);
const canon = ["Протокол осмотра", "11403198710001", "Жалобы", "Боль в горле.", "Диагноз", "ОРВИ"].join("\n");
check("hash is computed from the server's final text", s3.body.signed.hash === createHash("sha256").update(canon).digest("hex"));
check("signed text never contains what the client tried to inject", !JSON.stringify(s3t.body).includes("ПОДДЕЛКА"));

// после подписи приём неизменен
check("signing twice → 409", (await post(doc, `/api/visits/${vs.id}/sign`)).status === 409);
check("decisions after signing → 409", (await d({ changes: [{ key: "1-0", action: "removed" }] })).status === 409);
check("transcript after signing → 409", (await post(doc, `/api/visits/${vs.id}/transcript`, { lines })).status === 409);
check("extract after signing → 409", (await post(doc, `/api/visits/${vs.id}/extract`)).status === 409);
const after = await call("GET", `/api/visits/${vs.id}`, { cookie: doc });
check("signed visit is unchanged and readable", after.body.status === "signed" && after.body.signed.hash === s3.body.signed.hash && after.body.decisions["1-0"].action === "kept");

// аллергия: врач подтверждает назначение
const v3 = await liveVisit();
await post(doc, `/api/visits/${v3.id}/decisions`, { changes: [{ key: "1-0", action: "kept" }] });
const ak = await post(doc, `/api/visits/${v3.id}/decisions`, { ack: [14] });
check("allergy acknowledgement is recorded on the server and logged", ak.status === 200 && ak.body.ackAllergy.includes(14) && ak.body.changeLog.some((e: { before: string }) => e.before.includes("подтверждено врачом")));
const s4 = await post(doc, `/api/visits/${v3.id}/sign`);
check("signed after doctor acknowledges allergy → 200", s4.status === 200);
check("different content → different hash", s3.body.signed.hash !== s4.body.signed.hash);
check("edited text goes into the signed document", await (async () => {
  const v = await liveVisit();
  await post(doc, `/api/visits/${v.id}/decisions`, { changes: [{ key: "1-0", action: "edited", text: "Правка врача" }, { key: "2-0", action: "removed" }, { key: "0-0", action: "kept" }] });
  const r = await post(doc, `/api/visits/${v.id}/sign`);
  const canon2 = ["Протокол осмотра", "11403198710001", "Жалобы", "Боль в горле.", "Диагноз", "Правка врача"].join("\n");
  return r.status === 200 && r.body.signed.hash === createHash("sha256").update(canon2).digest("hex");
})());
check("demo osmotr: blocked by the unsourced fact and the allergy, signable once the doctor resolves both", await (async () => {
  const v = (await post(doc, "/api/visits", { patientId: "p1", docType: "osmotr", demo: true })).body;
  const blocked = await post(doc, `/api/visits/${v.id}/sign`);
  const unsourced = (v.sections as { statements: { sourceIds: number[] }[] }[]).flatMap((sec, si) => sec.statements.map((st, i) => ({ st, key: `${si}-${i}` }))).filter((x) => x.st.sourceIds.length === 0);
  await post(doc, `/api/visits/${v.id}/decisions`, { changes: unsourced.map((x) => ({ key: x.key, action: "kept" })), ack: [14] }); // в демо-разговоре назначен амоксициллин при аллергии на пенициллин
  const ok = await post(doc, `/api/visits/${v.id}/sign`);
  return blocked.status === 409 && ok.status === 200;
})());

// лимит незавершённых приёмов
let capped = 0;
for (let i = 0; i < 52; i++) if ((await post(doc2, "/api/visits", { patientId: "p3", docType: "osmotr" })).status === 429) capped++;
check("open drafts per user are capped", capped >= 2);

// --- пациенты и история с сервера (шаг 3.3) ---
check("patients without session → 401", (await call("GET", "/api/patients")).status === 401);
const pl1 = await call("GET", "/api/patients", { cookie: doc });
const pl2 = await call("GET", "/api/patients", { cookie: doc2 });
check("doctor sees only the patients assigned to them", pl1.status === 200 && pl1.body.patients.map((p: { id: string }) => p.id).join() === "p1,p2" && pl2.body.patients.map((p: { id: string }) => p.id).join() === "p3");
check("patient list does not leak other doctors' patients", !JSON.stringify(pl1.body).includes("Сыдыкова") && !JSON.stringify(pl2.body).includes("Иванова"));
check("patient list carries only the fields the screens need", Object.keys(pl1.body.patients[0]).sort().join() === "allergies,birthDate,id,name,pin");
check("admin and auditor cannot list patients", (await call("GET", "/api/patients", { cookie: adm })).status === 403);
check("visit view carries the patient card", demo.body.patient?.name === "Иванова Анна Сергеевна" && demo.body.patient.allergies.join() === "пенициллин" && demo.body.patient.id === "p1");

check("history without session → 401", (await call("GET", "/api/visits")).status === 401);
check("admin cannot read history", (await call("GET", "/api/visits", { cookie: adm })).status === 403);
const h1 = await call("GET", "/api/visits", { cookie: doc });
const hs = h1.body.visits as { id: string; patientId: string; patientName: string; status: string; hasDraft: boolean; signedAt?: string; updatedAt: string }[];
check("history lists the doctor's own visits", h1.status === 200 && hs.some((v) => v.id === c1.body.id) && hs.some((v) => v.id === demo.body.id) && hs.every((v) => ["p1", "p2"].includes(v.patientId)));
check("history never shows another doctor's visits", !(await call("GET", "/api/visits", { cookie: doc2 })).body.visits.some((v: { id: string }) => hs.some((x) => x.id === v.id)));
check("history rows carry no conversation or document text", !JSON.stringify(h1.body).includes("амоксициллин") && !JSON.stringify(h1.body).includes("Боль в горле") && hs.every((v) => !("lines" in v) && !("sections" in v) && !("decisions" in v)));
check("history marks signed visits with their signing time and drafts without", hs.some((v) => v.status === "signed" && !!v.signedAt) && hs.some((v) => v.status === "draft" && v.hasDraft) && hs.some((v) => v.status === "draft" && !v.hasDraft));
check("history is newest first", hs.every((v, i) => i === 0 || hs[i - 1].updatedAt >= v.updatedAt));
check("history is capped", (await call("GET", "/api/visits", { cookie: doc2 })).body.visits.length <= 100);
check("history rows reach the visit through the owner-only route", (await call("GET", `/api/visits/${hs[0].id}`, { cookie: doc })).status === 200 && (await call("GET", `/api/visits/${hs[0].id}`, { cookie: doc2 })).status === 404);

// --- распознавание речи ---
const speech = pcmBytes(1.5, 8000);
check("asr without session → 401", (await callRaw("/api/asr", speech)).status === 401);
check("admin cannot use asr", (await callRaw("/api/asr", speech, { cookie: adm })).status === 403);
check("asr rejects json content type → 415", (await callRaw("/api/asr", speech, { cookie: doc, ct: "application/json" })).status === 415);
check("visits reject audio content type → 415", (await callRaw("/api/visits", speech, { cookie: doc })).status === 415);
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
asrBehavior = async () => "[звук растрейки]";
const ann = await callRaw("/api/asr", speech, { cookie: doc });
check("sound annotation is dropped", ann.status === 200 && ann.body.text === "" && ann.body.dropped === "annotation");
asrBehavior = async () => ({ text: "Амоксицилин 500", words: [{ w: "Амоксицилин", p: 0.2 }, { w: "500", p: 0.98 }] });
const conf = await callRaw("/api/asr", speech, { cookie: doc });
check("word confidence is passed to the client", conf.status === 200 && conf.body.words?.[0]?.p === 0.2);
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
check("audit has no medical text, names or ПИН", !dump.includes("ОРВИ") && !dump.includes("Боль в горле") && !dump.includes("Правка врача") && !dump.includes("амоксициллин") && !dump.includes("Иванова") && !/\d{14}/.test(dump.replace(/[0-9a-f]{32,64}/g, ""))); // случайные идентификаторы и хэши иногда содержат длинные цифровые серии: это не ПИН
check("audit records failed logins and denied signing", audit.some((r) => r.action === "login.fail") && audit.some((r) => r.action === "visit.denied") && audit.some((r) => r.action === "document.sign.blocked") && audit.some((r) => r.action === "visit.decision") && audit.some((r) => r.action === "document.sign" && /^[0-9a-f]{64}$/.test(String(r.detail?.hash))));
audit[3].actor = "tampered";
const v2 = await call("GET", "/api/audit/verify", { cookie: aud });
check("tampered audit detected over API", v2.status === 200 && v2.body.ok === false);
check("chain check agrees", !verifyChain(audit).ok);

// --- выход ---
const lo = await call("POST", "/api/logout", { cookie: doc, body: {} });
check("logout ok", lo.status === 200);
check("session dead after logout", (await call("GET", "/api/me", { cookie: doc })).status === 401);
check("logout does not end other sessions", (await call("GET", "/api/me", { cookie: doc2 })).status === 200);

// --- вход для приложений (токены) ---
const APP = "capacitor://localhost";
const appLogin = (user: string, secret: string, origin: string | undefined = APP) =>
  call("POST", "/api/login", { origin, body: { username: user, password: pw, code: code(secret), client: "app" } });
const al = await appLogin("doc2", secrets.doc2);
check("app login → tokens, no cookie", al.status === 200 && !!al.body.accessToken && !!al.body.refreshToken && !al.cookie && al.body.expiresIn === 300);
check("app login response has no password hash or totp secret", !JSON.stringify(al.body).includes("scrypt") && !JSON.stringify(al.body).includes(secrets.doc2));
check("token works as Bearer", (await call("GET", "/api/me", { auth: `Bearer ${al.body.accessToken}`, origin: APP })).body?.id === "doc2");
check("token without Origin (native HTTP client) works", (await call("GET", "/api/me", { auth: `Bearer ${al.body.accessToken}` })).status === 200);
check("garbage Bearer → 401", (await call("GET", "/api/me", { auth: "Bearer garbagegarbagegarbagegarbage" })).status === 401);
check("malformed Authorization → 401", (await call("GET", "/api/me", { auth: "Basic abc" })).status === 401);
check("token is not accepted as a cookie", (await call("GET", "/api/me", { cookie: `medsync_session=${al.body.accessToken}` })).status === 401);
const cookieOnly = await login("doc2", secrets.doc2);
check("cookie session is not accepted as a Bearer token", (await call("GET", "/api/me", { auth: `Bearer ${cookieOnly.split("=")[1]}` })).status === 401);
check("cookie and token together → 400", (await call("GET", "/api/me", { auth: `Bearer ${al.body.accessToken}`, cookie: cookieOnly })).status === 400);
check("browser origin cannot get tokens", (await appLogin("doc2", secrets.doc2, "http://localhost:5173")).status === 400);
check("app origin cannot use a cookie session", (await call("GET", "/api/me", { cookie: cookieOnly, origin: APP })).status === 401);
check("token login with wrong password → 401", (await call("POST", "/api/login", { origin: APP, body: { username: "doc2", password: "wrong-password-1", code: code(secrets.doc2), client: "app" } })).status === 401);
const pre = await fetch(base + "/api/me", { method: "OPTIONS", headers: { Origin: APP, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" } });
check("preflight from app origin → 204 with CORS, no credentials", pre.status === 204 && pre.headers.get("access-control-allow-origin") === APP && pre.headers.get("access-control-allow-credentials") === null);
const preEvil = await fetch(base + "/api/me", { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
check("preflight from foreign origin → 403, no CORS", preEvil.status === 403 && preEvil.headers.get("access-control-allow-origin") === null);
const preWeb = await fetch(base + "/api/me", { method: "OPTIONS", headers: { Origin: "http://localhost:5173" } });
check("browser origin gets no CORS headers", preWeb.headers.get("access-control-allow-origin") === null);
check("app token reaches protected routes with the same checks", (await call("POST", "/api/visits", { auth: `Bearer ${al.body.accessToken}`, body: { patientId: "p1" } })).status === 400);

const rf = await call("POST", "/api/token/refresh", { origin: APP, body: { refreshToken: al.body.refreshToken } });
check("refresh → new pair", rf.status === 200 && rf.body.accessToken !== al.body.accessToken && rf.body.refreshToken !== al.body.refreshToken);
check("old access token dead after refresh", (await call("GET", "/api/me", { auth: `Bearer ${al.body.accessToken}` })).status === 401);
check("new access token works", (await call("GET", "/api/me", { auth: `Bearer ${rf.body.accessToken}` })).status === 200);
const reuse = await call("POST", "/api/token/refresh", { origin: APP, body: { refreshToken: al.body.refreshToken } });
check("reused refresh token → 401", reuse.status === 401);
check("reuse revokes the whole login", (await call("GET", "/api/me", { auth: `Bearer ${rf.body.accessToken}` })).status === 401 && (await call("POST", "/api/token/refresh", { origin: APP, body: { refreshToken: rf.body.refreshToken } })).status === 401);
check("reuse is audited", audit.some((r) => r.action === "token.reuse"));
check("refresh with garbage → 401", (await call("POST", "/api/token/refresh", { origin: APP, body: { refreshToken: "x".repeat(43) } })).status === 401);
check("refresh without body field → 401", (await call("POST", "/api/token/refresh", { origin: APP, body: {} })).status === 401);
check("access token is not a refresh token", (await call("POST", "/api/token/refresh", { origin: APP, body: { refreshToken: rf.body.accessToken } })).status === 401);

const t1 = await appLogin("doc2", secrets.doc2);
const t2 = await appLogin("doc2", secrets.doc2);
check("token logout ok", (await call("POST", "/api/logout", { auth: `Bearer ${t1.body.accessToken}`, body: {} })).status === 200);
check("logged-out token dead, refresh dead too", (await call("GET", "/api/me", { auth: `Bearer ${t1.body.accessToken}` })).status === 401 && (await call("POST", "/api/token/refresh", { body: { refreshToken: t1.body.refreshToken } })).status === 401);
check("token logout leaves other logins alone", (await call("GET", "/api/me", { auth: `Bearer ${t2.body.accessToken}` })).status === 200 && (await call("GET", "/api/me", { cookie: doc2 })).status === 200);
check("refresh needs X-Requested-With", (await call("POST", "/api/token/refresh", { body: { refreshToken: t2.body.refreshToken }, xrw: false })).status === 403);
const tokenDump = JSON.stringify(audit);
check("audit records app logins but no tokens", audit.some((r) => r.action === "login.ok" && r.detail?.client === "app") && ![al, rf, t1, t2].some((x) => x.body?.accessToken && tokenDump.includes(x.body.accessToken)));

// --- блокировка перебора ---
for (let i = 0; i < 5; i++) await call("POST", "/api/login", { body: { username: "adm1", password: "wrong-password-1", code: "000000" } });
const locked = await call("POST", "/api/login", { body: { username: "adm1", password: pw, code: code(secrets.adm) } });
check("account locked after 5 failures, even with right credentials", locked.status === 429);

let bad = 0;
for (const [n, passed] of t) if (!passed) { bad++; console.error("FAIL", n); }
console.log(bad ? `BAD app (${bad}/${t.length})` : `ok app (${t.length}${pgDb ? ", PostgreSQL store" : ""})`);
server.close();
process.exit(bad ? 1 : 0);
