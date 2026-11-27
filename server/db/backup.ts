// Резервная копия и проверка восстановления (restore drill).
// Копия содержит только то, что лежит в базе: служебные поля открыто и медицинский текст в зашифрованном виде.
// Ключи (DATA_KEYS) в копию НЕ входят и хранятся отдельно: копия без ключа бесполезна, ключ без копии тоже.
import { createHash } from "node:crypto";
import type { Patient } from "../../src/data/patients";
import { documentHash } from "../visits";
import type { Keyring } from "./crypto";
import type { Db, Queryable } from "./db";
import { loadMigrations, migrate } from "./migrate";
import { rowToVisit, type VisitRow } from "./visit-store";

export interface BackupRow {
  id: string; owner_id: string; patient_id: string; doc_type: string; source: string; status: string;
  version: number; created_at: string; updated_at: string; signed_hash: string | null; key_id: string; payload: string; // base64
}

export interface BackupBody {
  format: 1;
  createdAt: string;
  engine: string;
  migrations: { name: string; sha256: string }[];
  visits: BackupRow[];
}
export interface BackupFile extends BackupBody { sha256: string }

const sum = (b: BackupBody) => createHash("sha256").update(JSON.stringify(b)).digest("hex");

export async function exportBackup(db: Db, now = new Date()): Promise<BackupFile> {
  const migrations = (await db.query<{ name: string; sha256: string }>("SELECT name, sha256 FROM schema_migrations ORDER BY name")).rows;
  const rows = (await db.query<VisitRow>("SELECT * FROM visits ORDER BY id")).rows;
  const body: BackupBody = {
    format: 1,
    createdAt: now.toISOString(),
    engine: db.engine,
    migrations,
    visits: rows.map((r) => ({
      id: r.id, owner_id: r.owner_id, patient_id: r.patient_id, doc_type: r.doc_type, source: r.source, status: r.status, version: r.version,
      created_at: new Date(r.created_at).toISOString(), updated_at: new Date(r.updated_at).toISOString(),
      signed_hash: r.signed_hash, key_id: r.key_id, payload: Buffer.from(r.payload).toString("base64"),
    })),
  };
  return { ...body, sha256: sum(body) };
}

export const serializeBackup = (b: BackupFile) => JSON.stringify(b);

/** Разбирает файл копии и проверяет контрольную сумму: повреждённый или изменённый файл не принимается. */
export function parseBackup(text: string): BackupFile {
  let b: BackupFile;
  try { b = JSON.parse(text) as BackupFile; } catch { throw new Error("Файл копии не читается (не JSON)"); }
  if (!b || b.format !== 1 || !Array.isArray(b.visits) || !Array.isArray(b.migrations) || typeof b.sha256 !== "string") throw new Error("Неизвестный формат копии");
  const { sha256, ...body } = b;
  if (sum(body as BackupBody) !== sha256) throw new Error("Контрольная сумма копии не совпала: файл повреждён или изменён");
  return b;
}

export interface RestoreResult { visits: number }

/** Восстанавливает копию в ПУСТУЮ базу одной транзакцией: при любой ошибке не остаётся ничего. */
export async function restoreBackup(db: Db, backup: BackupFile): Promise<RestoreResult> {
  const known = new Map(loadMigrations().map((m) => [m.name, m.sha256]));
  for (const m of backup.migrations) {
    if (known.get(m.name) !== m.sha256) throw new Error(`Копия сделана другой версией схемы (${m.name}). Обновите программу до версии, создавшей копию.`);
  }
  await migrate(db);
  const existing = await db.query<{ n: string | number }>("SELECT count(*) AS n FROM visits");
  if (Number(existing.rows[0].n) !== 0) throw new Error("База не пуста: восстановление возможно только в пустую базу");
  await db.transaction(async (tx: Queryable) => {
    for (const r of backup.visits) {
      await tx.query(
        `INSERT INTO visits (id, owner_id, patient_id, doc_type, source, status, version, created_at, updated_at, signed_hash, key_id, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [r.id, r.owner_id, r.patient_id, r.doc_type, r.source, r.status, r.version, r.created_at, r.updated_at, r.signed_hash, r.key_id, Buffer.from(r.payload, "base64")],
      );
    }
  });
  return { visits: backup.visits.length };
}

export interface VerifyResult {
  visits: number;
  signed: number;
  problems: string[];
}

/**
 * Проверка целостности базы (после восстановления или по расписанию): каждая строка расшифровывается и проходит проверку
 * подлинности, а для каждого подписанного приёма хэш документа пересчитывается и сверяется с подписанным.
 */
export async function verifyDatabase(db: Db, ring: Keyring, patients: Patient[]): Promise<VerifyResult> {
  const rows = (await db.query<VisitRow>("SELECT * FROM visits ORDER BY id")).rows;
  const problems: string[] = [];
  let signed = 0;
  for (const r of rows) {
    try {
      const v = rowToVisit(ring, r);
      if (v.status === "signed") {
        signed++;
        const patient = patients.find((p) => p.id === v.patientId);
        if (!patient) problems.push(`${r.id}: пациент ${v.patientId} не найден`);
        else if (documentHash(v, patient) !== v.signed?.hash) problems.push(`${r.id}: текст документа не соответствует подписанному хэшу`);
      }
    } catch (e) {
      problems.push(`${r.id}: ${e instanceof Error ? e.message : "ошибка"}`);
    }
  }
  return { visits: rows.length, signed, problems };
}
