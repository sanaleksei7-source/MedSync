// Тесты правил паролей и экстренного доступа.
import { otpauthUri, passwordProblem, publicUser, tempPassword, USERNAME } from "./accounts";
import { BreakGlass, GRANT_MS, MAX_ACTIVE, isReason } from "./breakglass";
import { canAccessPatient, type Actor } from "./rbac";

const t: [string, boolean][] = [];
const check = (name: string, ok: boolean) => t.push([name, ok]);

check("short password refused", passwordProblem("short", "old-password-123", "u") !== null);
check("same as current refused", passwordProblem("old-password-123", "old-password-123", "u") !== null);
check("password containing the user name refused (any case)", passwordProblem("my-DoctorOne-pass-1", "x", "doctorone") !== null);
check("one repeated character refused", passwordProblem("aaaaaaaaaaaaaaaa", "x", "u") !== null);
check("long password over 256 refused", passwordProblem("a1".repeat(200), "x", "u") !== null);
check("a good password passes", passwordProblem("correct-horse-battery-1", "old-password-123", "doctorone") === null);
check("one-time passwords are long, random and url-safe", (() => { const a = tempPassword(), b = tempPassword(); return a !== b && a.length >= 20 && /^[A-Za-z0-9_-]+$/.test(a); })());
check("user names: lower case, 3–32 chars, no spaces", USERNAME.test("doc.one-2") && !USERNAME.test("ab") && !USERNAME.test("Doc") && !USERNAME.test("a b") && !USERNAME.test("-abc"));
check("authenticator link carries issuer, digits and period", otpauthUri("d@x", "ABC234") === "otpauth://totp/MedSync:d%40x?secret=ABC234&issuer=MedSync&digits=6&period=30");
check("public view has no hash or secret", (() => { const v = JSON.stringify(publicUser({ id: "u", username: "u", name: "n", role: "doctor", passwordHash: "scrypt$x$y", totpSecret: "SECRET", assignedPatients: [], pendingTotp: "P" })); return !v.includes("scrypt") && !v.includes("SECRET") && !v.includes("\"P\""); })());

// экстренный доступ
const bg = new BreakGlass();
const T0 = 1_000_000;
check("grant, then active", bg.grant("d", "p1", T0) === "ok" && bg.active("d", T0 + 1000).join() === "p1");
check("expires exactly at the end of the grant period", bg.active("d", T0 + GRANT_MS - 1).length === 1 && bg.active("d", T0 + GRANT_MS).length === 0);
check("not active for other users", new BreakGlass().active("x", T0).length === 0 && (() => { const b = new BreakGlass(); b.grant("d", "p1", T0); return b.active("e", T0).length === 0; })());
check("at most three cards at once, a repeat of an open one is fine", (() => {
  const b = new BreakGlass();
  const r = ["p1", "p2", "p3", "p4"].map((p) => b.grant("d", p, T0));
  return r.slice(0, MAX_ACTIVE).every((x) => x === "ok") && r[MAX_ACTIVE] === "limit" && b.grant("d", "p2", T0 + 1) === "ok";
})());
check("expired grants free a slot", (() => { const b = new BreakGlass(); ["p1", "p2", "p3"].forEach((p) => b.grant("d", p, T0)); return b.grant("d", "p4", T0 + GRANT_MS + 1) === "ok"; })());
check("end and endAll", (() => { const b = new BreakGlass(); b.grant("d", "p1", T0); b.grant("d", "p2", T0); const e = b.end("d", "p1"); const a = b.active("d", T0).join(); b.endAll("d"); return e && a === "p2" && b.active("d", T0).length === 0 && !b.end("d", "p9"); })());
check("reasons come from a fixed list", isReason("emergency") && isReason("covering") && !isReason("free text") && !isReason("__proto__") && !isReason(undefined));

// права при экстренном доступе
const doc: Actor = { id: "d", role: "doctor", assignedPatients: ["p1"], emergencyPatients: ["p4"] };
check("emergency patient: read and edit visits allowed", canAccessPatient(doc, "patient.read", "p4") && canAccessPatient(doc, "visit.edit", "p4"));
check("emergency patient: signing, extract and the rest stay closed", !canAccessPatient(doc, "document.sign", "p4") && !canAccessPatient(doc, "extract.run", "p4"));
check("emergency access does not open other patients", !canAccessPatient(doc, "visit.edit", "p3"));
check("emergency access gives admin and auditor nothing", !canAccessPatient({ id: "a", role: "admin", assignedPatients: [], emergencyPatients: ["p4"] }, "patient.read", "p4") && !canAccessPatient({ id: "x", role: "auditor", assignedPatients: [], emergencyPatients: ["p4"] }, "visit.edit", "p4"));

let bad = 0;
for (const [n, ok] of t) if (!ok) { bad++; console.error("FAIL", n); }
console.log(bad ? `BAD accounts (${bad}/${t.length})` : `ok accounts (${t.length})`);
process.exit(bad ? 1 : 0);
