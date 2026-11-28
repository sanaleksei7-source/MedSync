// Тесты работы за прокси: адрес клиента, заголовки, cookie рабочей среды, ограничение по адресу.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createHandler } from "./app";
import { LoginThrottle, SessionStore, hashPassword, newTotpSecret, totpAt } from "./auth";
import { DemoSigner } from "./signer";
import { clientIp, ipTag } from "./net";
import type { AuditRecord } from "./audit";

const t: [string, boolean][] = [];
const check = (n: string, ok: boolean) => t.push([n, ok]);
const fake = (remote: string, xff?: string) => ({ socket: { remoteAddress: remote }, headers: xff ? { "x-forwarded-for": xff } : {} }) as unknown as http.IncomingMessage;

check("without trustProxy the socket address is used", clientIp(fake("127.0.0.1", "1.2.3.4"), false) === "127.0.0.1");
check("behind our proxy the last forwarded address is the client", clientIp(fake("127.0.0.1", "6.6.6.6, 1.2.3.4"), true) === "1.2.3.4");
check("a request not coming from the local proxy cannot fake its address", clientIp(fake("9.9.9.9", "1.2.3.4"), true) === "9.9.9.9");
check("garbage in X-Forwarded-For falls back to the socket address", clientIp(fake("127.0.0.1", "<script>"), true) === "127.0.0.1" && clientIp(fake("::1"), true) === "::1");
check("IPv6 forwarded addresses work", clientIp(fake("::ffff:127.0.0.1", "2001:db8::1"), true) === "2001:db8::1");
check("address tags are stable, short, and depend on the server key", ipTag("1.2.3.4", "k") === ipTag("1.2.3.4", "k") && ipTag("1.2.3.4", "k") !== ipTag("1.2.3.4", "k2") && ipTag("1.2.3.4", "k") !== ipTag("1.2.3.5", "k") && /^[0-9a-f]{16}$/.test(ipTag("x", "k")));

// сервер в режиме «за прокси в интернете»
const secret = newTotpSecret();
const pw = "net-test-password-1";
const passwordHash = await hashPassword(pw);
const audit: AuditRecord[] = [];
const srv = http.createServer();
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const port = (srv.address() as AddressInfo).port;
const handler = createHandler({
  users: [{ id: "d1", username: "d1", name: "d1", role: "doctor", passwordHash, totpSecret: secret, assignedPatients: [] }],
  sessions: new SessionStore(), throttle: new LoginThrottle(5, 60_000), signer: new DemoSigner("k"), audit, persistAudit: () => {}, extract: async () => [],
  allowedOrigins: ["https://medsync.example.kg"], allowedHosts: ["medsync.example.kg"], secureCookie: true, hsts: true, trustProxy: true, ipKey: "test-key",
  ipLimitPerMinute: 4, dummyHash: passwordHash,
});
srv.on("request", (req, res) => void handler(req, res));
// fetch не даёт подменить Host, поэтому запросы через http.request.
interface Res { status: number; headers: { get(n: string): string | null } }
const call = (path: string, init: { method?: string; body?: unknown; xff?: string; cookie?: string; host?: string } = {}) =>
  new Promise<Res>((resolve, reject) => {
    const body = init.body ? JSON.stringify(init.body) : undefined;
    const req = http.request({ host: "127.0.0.1", port, path, method: init.method ?? "GET", headers: {
      Host: init.host ?? "medsync.example.kg", ...(init.xff ? { "X-Forwarded-For": init.xff } : {}), ...(init.cookie ? { Cookie: init.cookie } : {}),
      ...(body ? { "Content-Type": "application/json", "X-Requested-With": "medsync", "Content-Length": Buffer.byteLength(body) } : {}) } }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: { get: (n) => { const v = res.headers[n.toLowerCase()]; return v === undefined ? null : Array.isArray(v) ? v.join(", ") : String(v); } } }));
    });
    req.on("error", reject);
    req.end(body);
  });

const r1 = await call("/api/me", { xff: "10.1.1.1" });
check("API responses carry HSTS, CSP, frame and referrer protection", /max-age=31536000/.test(r1.headers.get("strict-transport-security") ?? "") && r1.headers.get("content-security-policy")?.includes("default-src 'none'") === true && r1.headers.get("x-frame-options") === "DENY" && r1.headers.get("referrer-policy") === "no-referrer");
check("unknown Host is refused", (await call("/api/me", { host: "evil.example" })).status === 403);
const login = await call("/api/login", { method: "POST", body: { username: "d1", password: pw, code: totpAt(secret, Date.now()) }, xff: "10.2.2.2" });
const sc = login.headers.get("set-cookie") ?? "";
check("production cookie is __Host- prefixed, Secure, HttpOnly, SameSite=Strict", sc.startsWith("__Host-medsync_session=") && /; Secure/.test(sc) && /HttpOnly/.test(sc) && /SameSite=Strict/.test(sc) && /Path=\//.test(sc) && !/Domain=/i.test(sc));
const cookie = sc.split(";")[0];
check("the login cookie is a browser-session cookie (no Max-Age, no Expires)", !/Max-Age|Expires/i.test(sc));
check("the __Host- cookie works for later requests", (await call("/api/me", { cookie, xff: "10.2.2.2" })).status === 200);
check("the plain cookie name is not accepted in production", (await call("/api/me", { cookie: cookie.replace("__Host-", ""), xff: "10.2.2.2" })).status === 401);
const lo = await call("/api/logout", { method: "POST", body: {}, cookie, xff: "10.2.2.2" });
check("logout clears the cookie with Secure (required for __Host- cookies)", /Max-Age=0/.test(lo.headers.get("set-cookie") ?? "") && /; Secure/.test(lo.headers.get("set-cookie") ?? ""));
check("login records an address tag, never the address", audit.some((r) => r.action === "login.ok" && r.detail?.ip === ipTag("10.2.2.2", "test-key")) && !JSON.stringify(audit).includes("10.2.2.2"));

// ограничение по адресу работает по настоящему адресу клиента, а не по адресу прокси
let limitedA = false;
for (let i = 0; i < 5; i++) if ((await call("/api/me", { xff: "10.9.9.9" })).status === 429) limitedA = true;
const otherClient = await call("/api/me", { xff: "10.8.8.8" });
check("rate limit applies per real client: one client is limited, another is not", limitedA && otherClient.status === 401);
srv.close();

let bad = 0;
for (const [n, ok] of t) if (!ok) { bad++; console.error("FAIL", n); }
console.log(bad ? `BAD net (${bad}/${t.length})` : `ok net (${t.length})`);
process.exit(bad ? 1 : 0);
