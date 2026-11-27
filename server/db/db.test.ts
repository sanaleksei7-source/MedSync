// Тесты слоя базы: шифрование, миграции, хранилище приёмов, резервная копия и проверка восстановления.
// Используется настоящий PostgreSQL внутри Node (PGlite), без внешнего сервера.
import { isDeepStrictEqual } from "node:util";
import { patients } from "../../src/data/patients";
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

for (const d of [fresh, db, src, target, partial] as Db[]) await d.close();

let bad = 0;
for (const [n, ok] of t) if (!ok) { bad++; console.error("FAIL", n); }
console.log(bad ? `BAD db (${bad}/${t.length})` : `ok db (${t.length})`);
process.exitCode = bad ? 1 : 0;
