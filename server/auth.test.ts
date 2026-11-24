import { LoginThrottle, SessionStore, hashPassword, newTotpSecret, totpAt, verifyPassword, verifyTotp } from "./auth";

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
