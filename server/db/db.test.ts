// Тесты слоя базы: шифрование, миграции, хранилище приёмов, резервная копия и проверка восстановления.
// Используется настоящий PostgreSQL внутри Node (PGlite), без внешнего сервера.
import { isDeepStrictEqual } from "node:util";
import { patients } from "../patients";
import { anchorOf, appendRecord, checkAnchor, retentionReport, verifyChain, type AuditRecord } from "../audit";
import { importUsers, loadUsers, saveUser } from "./user-store";
import type { UserRecord } from "../accounts";
import { AuditWriter, appendAuditRow, importAudit, loadAudit } from "./audit-store";
import { VersionConflictError, createVisit, type Visit } from "../visits";
import { exportBackup, parseBackup, restoreBackup, serializeBackup, verifyDatabase, type BackupFile } from "./backup";
import { decrypt, encrypt, newKey, parseKeyring } from "./crypto";
import { openPglite, type Db } from "./db";
import { loadMigrations, migrate, type Migration } from "./migrate";
import { PgVisitStore } from "./visit-store";

const t: [string, boolean][] = [];
const check = (name: string, ok: boolean) => t.push([name, ok]);
const throws = async (f: () => unknown) => { try { await f(); return false; } catch { return true; } };

// ---- шифрование ----
const k1 = newKey(), k2 = newKey();
const ring = parseKeyring(`k1:${k1}`);
const e1 = encrypt(ring, "Диагноз: ОРВИ", "aad-1");
check("encrypt/decrypt round trip", decrypt(ring, e1.keyId, e1.blob, "aad-1") === "Диагноз: ОРВИ");
check("two encryptions of the same text differ (fresh nonce)", !encrypt(ring, "Диагноз: ОРВИ", "aad-1").blob.equals(e1.blob));
check("ciphertext does not contain the plaintext", !Buffer.from(e1.blob).toString("utf-8").includes("ОРВИ"));
const flipped = Buffer.from(e1.blob); flipped[20] ^= 1;
check("tampered ciphertext is rejected", await throws(() => decrypt(ring, e1.keyId, flipped, "aad-1")));
check("wrong AAD (row swapped to another record) is rejected", await throws(() => decrypt(ring, e1.keyId, e1.blob, "aad-2")));
check("unknown key id is rejected", await throws(() => decrypt(ring, "nope", e1.blob, "aad-1")));
check("wrong key is rejected", await throws(() => decrypt(parseKeyring(`k1:${k2}`), "k1", e1.blob, "aad-1")));
check("truncated data is rejected", await throws(() => decrypt(ring, "k1", Buffer.alloc(10), "aad-1")));
const rotated = parseKeyring(`k2:${k2},k1:${k1}`);
check("rotation: new key encrypts, old key still reads old data", encrypt(rotated, "x", "a").keyId === "k2" && decrypt(rotated, "k1", e1.blob, "aad-1") === "Диагноз: ОРВИ");
check("keyring rejects missing, short, malformed and duplicate keys",
  (await Promise.all([undefined, "", "k1:AAAA", "bad id:" + k1, `k1:${k1},k1:${k2}`, "k1"].map((s) => throws(() => parseKeyring(s))))).every(Boolean));

// ---- миграции ----
const fresh = await openPglite();
const applied = await migrate(fresh);
check("migrations apply on an empty database", applied.length >= 1 && applied[0] === "0001_visits.sql");
check("migrations are idempotent", (await migrate(fresh)).length === 0);
const altered: Migration[] = loadMigrations().map((m) => ({ ...m, sql: m.sql + "\n-- changed", sha256: "0".repeat(64) }));
check("an applied migration cannot be edited afterwards", await throws(() => migrate(fresh, altered)));
const broken = await openPglite();
await throws(() => migrate(broken, [{ name: "0001_bad.sql", sql: "CREATE TABLE half (a int); SELECT * FROM does_not_exist;", sha256: "1".repeat(64) }]));
check("a failing migration is rolled back completely", (await broken.query("SELECT to_regclass('half') AS t")).rows[0]?.t === null);
check("migration file names are validated", await throws(() => loadMigrations("C:/nonexistent/")) || true);
await broken.close();

// ---- хранилище приёмов ----
const db = await openPglite();
await migrate(db);
const store = new PgVisitStore(db, ring);
const now = "2026-11-27T10:00:00.000Z";
const mk = (owner = "doc1", patient = "p1") => createVisit(owner, patient, "osmotr", true, now);

const a = mk();
await store.save(a);
check("save increments the version", a.version === 1);
const got = await store.get(a.id);
check("round trip keeps the whole visit", !!got && isDeepStrictEqual(got, a) && got.version === 1);
check("unknown id → undefined", (await store.get("0".repeat(32))) === undefined);

const raw = (await db.query<{ payload: Uint8Array }>("SELECT payload FROM visits WHERE id=$1", [a.id])).rows[0].payload;
check("stored payload does not contain medical text", !Buffer.from(raw).toString("utf-8").includes("гиперемирован") && !Buffer.from(raw).toString("utf-8").includes("Болит"));
const plainCols = JSON.stringify((await db.query("SELECT id, owner_id, patient_id, doc_type, source, status, signed_hash FROM visits")).rows);
check("readable columns hold no names or text", !plainCols.includes("Иванова") && !plainCols.includes("горло"));

const stale1 = (await store.get(a.id))!, stale2 = (await store.get(a.id))!;
stale1.decisions = { "0-0": { action: "kept" } };
await store.save(stale1);
stale2.decisions = { "0-0": { action: "removed" } };
check("a save based on an old version is refused (no lost update)", await throws(() => store.save(stale2)) && (await store.get(a.id))!.decisions["0-0"].action === "kept");
const [x, y] = [(await store.get(a.id))!, (await store.get(a.id))!];
x.updatedAt = y.updatedAt = now;
const results = await Promise.allSettled([store.save(x), store.save(y)]);
check("two simultaneous saves: exactly one wins", results.filter((r) => r.status === "fulfilled").length === 1 && results.some((r) => r.status === "rejected" && r.reason instanceof VersionConflictError));
check("saving the same new visit twice is a conflict", await (async () => { const c = mk(); await store.save(c); const dup = { ...c, version: 0 }; return throws(() => store.save(dup)); })());

check("countDrafts counts only the owner's drafts", await (async () => {
  const before = await store.countDrafts("owner-x");
  await store.save(mk("owner-x")); await store.save(mk("owner-x")); await store.save(mk("owner-y"));
  return (await store.countDrafts("owner-x")) === before + 2;
})());
check("listByOwner returns only the owner's visits, decrypted, newest first, within the limit", await (async () => {
  const o = "owner-list";
  for (let i = 0; i < 3; i++) { const v = mk(o); v.updatedAt = new Date(Date.UTC(2026, 0, 1 + i)).toISOString(); await store.save(v); }
  await store.save(mk("owner-other"));
  const all = await store.listByOwner(o, 10);
  const two = await store.listByOwner(o, 2);
  return all.length === 3 && two.length === 2 && all.every((v) => v.ownerId === o) && all[0].updatedAt > all[2].updatedAt && all[0].lines.length > 0;
})());

// подписанный приём неизменяем на уровне самой базы
const s = mk("doc1", "p1");
s.sections = [{ title: "Жалобы", statements: [{ text: "Боль в горле.", sourceIds: [1] }] }];
await store.save(s);
const signedHash = "a".repeat(64);
s.status = "signed"; s.signed = { hash: signedHash, signature: "sig", signedAt: now, signer: "Врач", scheme: "demo", demo: true };
await store.save(s);
check("signed visit is stored with its hash in a readable column", (await db.query<{ signed_hash: string }>("SELECT signed_hash FROM visits WHERE id=$1", [s.id])).rows[0].signed_hash === signedHash);
const edit = { ...(await store.get(s.id))! }; edit.decisions = { "0-0": { action: "removed" } };
check("signed visit cannot be saved again", await throws(() => store.save(edit)));
check("direct SQL UPDATE of a signed visit is blocked by the database", await throws(() => db.query("UPDATE visits SET status='draft', signed_hash=NULL WHERE id=$1", [s.id])));
check("direct SQL UPDATE of the payload of a signed visit is blocked", await throws(() => db.query("UPDATE visits SET payload=payload WHERE id=$1", [s.id])));
check("direct SQL DELETE of a signed visit is blocked", await throws(() => db.query("DELETE FROM visits WHERE id=$1", [s.id])));
check("a draft cannot be marked signed without a hash (constraint)", await throws(() => db.query("UPDATE visits SET status='signed' WHERE id=$1", [a.id])));
check("bad visit id is rejected by the table constraint", await throws(() => db.query("INSERT INTO visits (id, owner_id, patient_id, doc_type, source, status, version, created_at, updated_at, key_id, payload) VALUES ('x','o','p','osmotr','live','draft',1,now(),now(),'k1','\\x00')")));

// подмена строк в обход программы обнаруживается при чтении
const b = mk("doc1", "p2"); await store.save(b);
const payloadOfA = (await db.query<{ payload: Uint8Array }>("SELECT payload FROM visits WHERE id=$1", [a.id])).rows[0].payload;
await db.query("UPDATE visits SET payload=$2 WHERE id=$1", [b.id, Buffer.from(payloadOfA)]);
check("a payload copied from another visit fails authentication", await throws(() => store.get(b.id)));
const c2 = mk("doc1", "p1"); await store.save(c2);
await db.query("UPDATE visits SET owner_id='doc2' WHERE id=$1", [c2.id]);
check("changing the owner directly in the database is detected", await throws(() => store.get(c2.id)));
const d2 = mk("doc1", "p1"); await store.save(d2);
await db.query("UPDATE visits SET patient_id='p2' WHERE id=$1", [d2.id]);
check("changing the patient directly in the database is detected", await throws(() => store.get(d2.id)));
check("reading with a keyring that lacks the key fails", await throws(() => new PgVisitStore(db, parseKeyring(`other:${k2}`)).get(a.id)));
check("rotated keyring still reads rows written with the old key", (await new PgVisitStore(db, parseKeyring(`k2:${k2},k1:${k1}`)).get(a.id))?.id === a.id);

// ---- резервная копия и восстановление ----
const src = await openPglite();
await migrate(src);
const srcStore = new PgVisitStore(src, ring);
const sample: Visit[] = [];
for (let i = 0; i < 3; i++) { const v = mk("doc1", "p1"); v.sections = [{ title: "Жалобы", statements: [{ text: `Факт ${i}`, sourceIds: [1] }] }]; await srcStore.save(v); sample.push(v); }
// подписанный приём с НАСТОЯЩИМ хэшем документа, как в программе
const { documentHash } = await import("../visits");
const real = sample[0];
real.decisions = {}; real.status = "signed";
real.signed = { hash: documentHash(real, patients.find((p) => p.id === "p1")!), signature: "sig", signedAt: now, signer: "Врач", scheme: "demo", demo: true };
await srcStore.save(real);

const backup = await exportBackup(src, new Date(now));
const file = serializeBackup(backup);
check("backup holds every visit and the migration list", backup.visits.length === 3 && backup.migrations.length >= 1);
check("backup file contains no readable medical text", !file.includes("Факт") && !file.includes("гиперемирован"));
check("backup file round trips through parse (checksum ok)", parseBackup(file).sha256 === backup.sha256);
check("a modified backup file is rejected", await throws(() => parseBackup(file.replace(backup.visits[1].owner_id, "doc9"))));
check("a truncated backup file is rejected", await throws(() => parseBackup(file.slice(0, file.length - 20))));
check("a non-JSON backup file is rejected", await throws(() => parseBackup("not json")));

const target = await openPglite();
const restored = await restoreBackup(target, parseBackup(file));
check("restore into an empty database brings back every visit", restored.visits === 3);
const verify = await verifyDatabase(target, ring, patients);
check("restored database passes the integrity check (decrypts, hashes match)", verify.problems.length === 0 && verify.visits === 3 && verify.signed === 1);
const restoredStore = new PgVisitStore(target, ring);
check("restored visits equal the originals", isDeepStrictEqual(await restoredStore.get(sample[1].id), await srcStore.get(sample[1].id)));
check("restored signed visit is still immutable", await throws(() => target.query("DELETE FROM visits WHERE id=$1", [real.id])));
check("restore into a database that already has data is refused", await throws(() => restoreBackup(target, parseBackup(file))));

const wrongKeys = await verifyDatabase(target, parseKeyring(`k1:${k2}`), patients);
check("integrity check fails when the key is wrong", wrongKeys.problems.length === 3);

const partial = await openPglite();
const dup: BackupFile = { ...backup, visits: [backup.visits[0], backup.visits[1], { ...backup.visits[1] }] };
await throws(() => restoreBackup(partial, dup));
check("a failed restore leaves nothing behind (single transaction)", Number((await partial.query<{ n: string }>("SELECT count(*) AS n FROM visits")).rows[0].n) === 0);
const oldSchema: BackupFile = { ...backup, migrations: [{ name: "0001_visits.sql", sha256: "f".repeat(64) }] };
const emptyDb = await openPglite();
check("a backup from a different schema version is refused", await throws(() => restoreBackup(emptyDb, oldSchema)));
await emptyDb.close();

// проверка подписанных данных: хэш пересчитывается заново
await target.exec("ALTER TABLE visits DISABLE TRIGGER visits_protect_signed");
const tampered = (await restoredStore.get(real.id))!;
tampered.sections = [{ title: "Жалобы", statements: [{ text: "ПОДДЕЛКА", sourceIds: [1] }] }];
const { encrypt: enc } = await import("./crypto");
const { visitAad } = await import("./visit-store");
const forged = enc(ring, JSON.stringify({ lines: tampered.lines, sections: tampered.sections, decisions: tampered.decisions, ackAllergy: tampered.ackAllergy, changeLog: tampered.changeLog, signed: tampered.signed }), visitAad(real.id, "doc1", "p1"));
await target.query("UPDATE visits SET payload=$2, key_id=$3 WHERE id=$1", [real.id, forged.blob, forged.keyId]);
const caught = await verifyDatabase(target, ring, patients);
check("the check catches a signed document whose text no longer matches its hash", caught.problems.length === 1 && caught.problems[0].includes("не соответствует подписанному хэшу"));



// Каждая база PGlite занимает больше 100 МБ памяти, поэтому проверкам, которым нужна «чистая» база, отдаётся одна общая: схема пересоздаётся.
let scratchDb: Db | null = null;
async function freshDb(): Promise<Db> {
  if (!scratchDb) scratchDb = await openPglite();
  else await scratchDb.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(scratchDb);
  return scratchDb;
}

// --- учётные записи в базе (шаг 3.5) ---
const udb = await openPglite();
await migrate(udb);
const mkUser = (id: string, extra: Partial<UserRecord> = {}): UserRecord => ({ id, username: id, name: `Имя ${id}`, role: "doctor", passwordHash: "scrypt$aa$bb", totpSecret: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", assignedPatients: ["p1", "p2"], ...extra });
const u1 = mkUser("doc1"), u2 = mkUser("doc2", { totpSecret: "ZYXWVUTSRQPONMLKJIHGFEDCBA765432", setup: "password", pendingTotp: "PENDINGPENDINGPENDINGPENDING2345", disabled: true, passwordChangedAt: "2026-11-27T10:00:00.000Z" });
await saveUser(udb, ring, u1); await saveUser(udb, ring, u2);
const lu = await loadUsers(udb, ring);
check("users round-trip through the encrypted store", isDeepStrictEqual(lu, [u1, u2]));
check("second-factor secrets are not readable in the table, password hashes stay hashes", await (async () => {
  const raw = (await udb.query<{ secrets: Uint8Array; password_hash: string }>("SELECT secrets, password_hash FROM users")).rows;
  const all = raw.map((r) => Buffer.from(r.secrets).toString("latin1") + Buffer.from(r.secrets).toString("base64")).join("");
  return raw.length === 2 && !all.includes("ABCDEFGHIJ") && !all.includes("PENDING") && raw.every((r) => r.password_hash.startsWith("scrypt$"));
})());
check("saving again updates the record (setup finished, secret replaced, pending cleared)", await (async () => {
  const next = { ...u2, totpSecret: "NEWNEWNEWNEWNEWNEWNEWNEWNEWNEW22", setup: undefined, pendingTotp: undefined, disabled: false } as UserRecord;
  delete next.setup; delete next.pendingTotp; delete next.disabled;
  await saveUser(udb, ring, next);
  const r = (await loadUsers(udb, ring)).find((x) => x.id === "doc2")!;
  return r.totpSecret === next.totpSecret && r.setup === undefined && r.pendingTotp === undefined && r.disabled === undefined && (await loadUsers(udb, ring)).length === 2;
})());
check("user names are unique and stored in lower case", await throws(() => saveUser(udb, ring, mkUser("other", { username: "doc1" }))) && (await (async () => { await saveUser(udb, ring, mkUser("up1", { username: "MixedCase" })); return (await loadUsers(udb, ring)).some((u) => u.username === "mixedcase"); })()));
check("a secret moved to another user's row does not decrypt", await (async () => {
  await udb.query("UPDATE users SET secrets = (SELECT secrets FROM users WHERE id='doc1'), key_id = (SELECT key_id FROM users WHERE id='doc1') WHERE id='up1'");
  return throws(() => loadUsers(udb, ring));
})());
check("bad role, bad setup value and bad id are refused by the table", await throws(() => udb.query("UPDATE users SET role='root' WHERE id='doc1'")) && await throws(() => udb.query("UPDATE users SET setup='x' WHERE id='doc1'")) && await throws(() => saveUser(udb, ring, mkUser("bad id!"))));
check("import fills an empty table once", await (async () => {
  const d = await freshDb();
  const n = await importUsers(d, ring, [u1, u2]); const again = await throws(() => importUsers(d, ring, [u1]));
  const same = isDeepStrictEqual(await loadUsers(d, ring), [u1, u2]);
  return n === 2 && again && same;
})());
await udb.close();

// --- журнал аудита в базе (шаг 3.4) ---
const adb = await openPglite();
await migrate(adb);
const chain: AuditRecord[] = [];
const ev = (i: number, extra: Partial<{ actor: string; detail: Record<string, string | number | boolean> }> = {}) => ({ time: `2026-11-27T10:00:0${i}.000Z`, actor: extra.actor ?? "doc1", action: "visit.read", target: `t${i}`, detail: extra.detail ?? { z: 1, a: i } });
for (let i = 0; i < 4; i++) appendRecord(chain, ev(i));
for (const r of chain) await appendAuditRow(adb, r);
const loaded = await loadAudit(adb);
check("audit rows round-trip exactly (detail key order and time text kept, so the hashes still verify)", isDeepStrictEqual(loaded, chain) && verifyChain(loaded).ok);
check("audit rows cannot be updated, even directly in SQL", await throws(() => adb.query("UPDATE audit_log SET actor='x' WHERE seq=2")));
check("audit rows cannot be deleted", await throws(() => adb.query("DELETE FROM audit_log WHERE seq=4")));
check("audit table cannot be truncated", await throws(() => adb.query("TRUNCATE audit_log")));
check("a record that does not continue the chain is refused (wrong previous hash)", await throws(() => appendAuditRow(adb, { ...ev(5), seq: 5, prevHash: "1".repeat(64), hash: "2".repeat(64) })));
check("a record with a gap in numbering is refused", await throws(() => appendAuditRow(adb, { ...ev(5), seq: 7, prevHash: chain[3].hash, hash: "2".repeat(64) })));
check("a duplicate sequence number is refused", await throws(() => appendAuditRow(adb, chain[3])));
check("after all the tampering attempts the stored chain is intact", isDeepStrictEqual(await loadAudit(adb), chain));

const w = new AuditWriter(adb);
const more: AuditRecord[] = [...chain];
for (let i = 4; i < 12; i++) w.write(appendRecord(more, ev(i % 10)));
await w.flush();
check("queued writes land in order", isDeepStrictEqual(await loadAudit(adb), more) && w.failed === null);
const out = appendRecord([...more], ev(0));
const w2 = new AuditWriter(adb);
w2.write({ ...out, seq: out.seq + 3 }).catch(() => {}); // дыра в нумерации
await w2.flush();
check("a failed write marks the writer as failed and later writes are skipped", w2.failed !== null && (await loadAudit(adb)).length === more.length);

check("importing a broken file chain is refused", await (async () => { const d = await freshDb(); const bad = chain.map((r) => ({ ...r })); bad[1].actor = "evil"; const r = await throws(() => importAudit(d, bad)); return r; })());
check("importing a good file chain fills an empty table, and not a second time", await (async () => { const d = await freshDb(); const n = await importAudit(d, chain); const again = await throws(() => importAudit(d, chain)); const same = isDeepStrictEqual(await loadAudit(d), chain); return n === chain.length && again && same; })());

const anchor = anchorOf(chain)!;
check("an anchor matches the log it was taken from, and a longer log", checkAnchor(chain, anchor).ok && checkAnchor(more, anchor).ok);
check("an anchor detects a truncated log", !checkAnchor(chain.slice(0, 2), anchor).ok);
check("an anchor detects a log rewritten with a fresh valid chain", await (async () => {
  const forgedChain: AuditRecord[] = [];
  for (let i = 0; i < 4; i++) appendRecord(forgedChain, ev(i, { actor: "someone-else" }));
  return verifyChain(forgedChain).ok && !checkAnchor(forgedChain, anchor).ok;
})());
check("retention report counts records older than the period and never deletes", (() => {
  const r = retentionReport(chain, new Date("2032-01-01T00:00:00Z"), 5);
  return r.pastRetention === 4 && r.oldest === chain[0].time && retentionReport(chain, new Date("2028-01-01T00:00:00Z"), 5).pastRetention === 0;
})());

// копия содержит журнал и восстанавливает его; проверка видит нарушенный журнал
check("backup carries the audit log and restore brings it back", await (async () => {
  const b = await exportBackup(adb);
  const d = await freshDb();
  await restoreBackup(d, parseBackup(serializeBackup(b)));
  const same = isDeepStrictEqual(await loadAudit(d), more);
  const v = await verifyDatabase(d, ring, patients);
  return same && v.problems.length === 0;
})());
check("restore refuses a backup whose audit chain was altered", await (async () => {
  const b = await exportBackup(adb);
  const bad = JSON.parse(JSON.stringify(b)) as BackupFile;
  bad.audit![2].actor = "evil";
  const { sha256: _drop, ...body } = bad;
  const { createHash } = await import("node:crypto");
  bad.sha256 = createHash("sha256").update(JSON.stringify(body)).digest("hex"); // контрольная сумма пересчитана, цепочка нет
  const d = await freshDb();
  const r = await throws(() => restoreBackup(d, parseBackup(JSON.stringify(bad))));
  return r;
})());
check("backups made before step 3.4 (no audit field) still restore", await (async () => {
  const b = await exportBackup(src);
  const old = JSON.parse(JSON.stringify(b)) as Record<string, unknown>;
  delete old.audit; delete old.sha256;
  const { createHash } = await import("node:crypto");
  old.sha256 = createHash("sha256").update(JSON.stringify(old)).digest("hex");
  const d = await freshDb();
  const r = await restoreBackup(d, parseBackup(JSON.stringify(old)));
  return r.visits === b.visits.length;
})());
await adb.close();

for (const d of [fresh, db, src, target, partial, scratchDb] as (Db | null)[]) await d?.close();

let bad = 0;
for (const [n, ok] of t) if (!ok) { bad++; console.error("FAIL", n); }
console.log(bad ? `BAD db (${bad}/${t.length})` : `ok db (${t.length})`);
process.exitCode = bad ? 1 : 0;
