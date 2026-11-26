import { LoginThrottle, SessionStore, TokenStore, hashPassword, newTotpSecret, totpAt, verifyPassword, verifyTotp } from "./auth";

const t: [string, boolean][] = [];
// RFC 6238, приложение B: секрет "12345678901234567890" (base32 ниже), T=59 с → 94287082; последние 6 цифр.
t.push(["RFC6238 vector", totpAt("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000) === "287082"]);
const secret = newTotpSecret();
const now = 1_700_000_000_000;
t.push(["totp accepts current", verifyTotp(secret, totpAt(secret, now), now)]);
t.push(["totp accepts one step old", verifyTotp(secret, totpAt(secret, now - 30_000), now)]);
t.push(["totp rejects three steps old", !verifyTotp(secret, totpAt(secret, now - 90_000), now)]);
t.push(["totp rejects garbage", !verifyTotp(secret, "abcdef", now) && !verifyTotp(secret, "12345", now)]);

const th = new LoginThrottle(3, 1000);
th.fail("u", 0); th.fail("u", 1); th.fail("u", 2);
t.push(["throttle locks after 3", th.locked("u", 3)]);
t.push(["throttle is per user", !th.locked("other", 3)]);
t.push(["throttle unlocks after window", !th.locked("u", 2000)]);
th.fail("v", 2000); th.fail("v", 2001); th.fail("v", 2002);
th.reset("v");
t.push(["throttle reset only clears that user", !th.locked("v", 2003)]);

const s = new SessionStore(1000, 5000);
const a = s.create("u1", 0);
const b = s.create("u2", 0);
t.push(["session valid", s.get(a, 500)?.userId === "u1"]);
t.push(["session idle expiry", s.get(a, 1600) === null]);
t.push(["expiry of one session leaves others", s.get(b, 600)?.userId === "u2"]);
const c = s.create("u3", 0);
for (let i = 1; i <= 6; i++) s.get(c, i * 900);
t.push(["session absolute expiry", s.get(c, 6000) === null]);
t.push(["unknown token", s.get("nope", 0) === null && s.get(undefined, 0) === null]);
const d = s.create("u4", 10_000);
const e = s.create("u5", 10_000);
s.destroy(d);
t.push(["logout ends only that session", s.get(d, 10_100) === null && s.get(e, 10_100)?.userId === "u5"]);

// ---- Токены приложений: access 1 с·1000, idle 5000, absolute 20000 (условные мс) ----
const ts = new TokenStore(1000, 5000, 20000);
const p1 = ts.issue("u1", 0);
const p2 = ts.issue("u2", 0);
t.push(["token valid", ts.authenticate(p1.accessToken, 500)?.userId === "u1"]);
t.push(["access token expires", ts.authenticate(p1.accessToken, 1500) === null]);
const r1 = ts.refresh(p1.refreshToken, 1600);
t.push(["refresh after access expiry gives a new pair", !!r1 && "pair" in r1 && ts.authenticate(r1.pair.accessToken, 1700)?.userId === "u1"]);
t.push(["old access token dead after refresh", ts.authenticate(p1.accessToken, 1700) === null]);
t.push(["other login unaffected by refresh", ts.authenticate(p2.accessToken, 800)?.userId === "u2"]);
const again = ts.refresh(p1.refreshToken, 1800);
t.push(["reused refresh token flagged", !!again && "reuse" in again]);
t.push(["reuse revokes the new tokens too", !!r1 && "pair" in r1 && ts.authenticate(r1.pair.accessToken, 1900) === null && ts.refresh(r1.pair.refreshToken, 1900) === null]);
t.push(["reuse leaves other logins alone", ts.authenticate(p2.accessToken, 900)?.userId === "u2"]);
const p3 = ts.issue("u3", 10000);
t.push(["idle expiry kills refresh", ts.refresh(p3.refreshToken, 10000 + 5001) === null]);
const p4 = ts.issue("u4", 0);
let cur = p4;
for (let i = 1; i <= 5; i++) {
  const r = ts.refresh(cur.refreshToken, i * 4000);
  if (r && "pair" in r) cur = r.pair;
}
t.push(["active login survives idle limit", ts.authenticate(cur.accessToken, 20000)?.userId === "u4"]);
t.push(["absolute expiry stops refresh", ts.refresh(cur.refreshToken, 20001) === null]);
const p5 = ts.issue("u5", 0);
const p6 = ts.issue("u5", 0);
ts.revokeUser("u5");
t.push(["revokeUser ends all that user's logins", ts.authenticate(p5.accessToken, 10) === null && ts.authenticate(p6.accessToken, 10) === null && ts.authenticate(p2.accessToken, 10)?.userId === "u2"]);
t.push(["tokens are random and long", p1.accessToken !== p1.refreshToken && p1.accessToken.length >= 43]);
t.push(["undefined / empty tokens rejected", ts.authenticate(undefined, 0) === null && ts.refresh("", 0) === null]);

const run = async () => {
  const h = await hashPassword("correct horse battery");
  t.push(["password ok", await verifyPassword("correct horse battery", h)]);
  t.push(["password wrong", !(await verifyPassword("wrong horse battery!", h))]);
  t.push(["password salted", h !== (await hashPassword("correct horse battery"))]);
  t.push(["short password rejected", await hashPassword("short").then(() => false, () => true)]);
  t.push(["malformed hash rejected", !(await verifyPassword("x", "garbage"))]);
  let bad = 0;
  for (const [n, ok] of t) if (!ok) { bad++; console.error("FAIL", n); }
  console.log(bad ? `BAD auth (${bad})` : `ok auth (${t.length})`);
  if (bad) process.exit(1);
};
run();
