// Хранение журнала аудита в базе. Таблица только дописывается (триггеры в миграции 0002).
// Запись идёт через очередь: записи попадают в базу строго по порядку, как в хэш-цепочке.
import { verifyChain, type AuditRecord } from "../audit";
import type { Db, Queryable } from "./db";

interface Row { seq: string | number; time: string; actor: string; action: string; target: string | null; detail: string | null; prev_hash: string; hash: string }

const toRecord = (r: Row): AuditRecord => ({
  seq: Number(r.seq),
  time: r.time,
  actor: r.actor,
  action: r.action,
  ...(r.target !== null ? { target: r.target } : {}),
  ...(r.detail !== null ? { detail: JSON.parse(r.detail) } : {}),
  prevHash: r.prev_hash,
  hash: r.hash,
});

export async function loadAudit(db: Queryable): Promise<AuditRecord[]> {
  return (await db.query<Row>("SELECT * FROM audit_log ORDER BY seq")).rows.map(toRecord);
}

export async function appendAuditRow(db: Queryable, r: AuditRecord): Promise<void> {
  await db.query(
    "INSERT INTO audit_log (seq, time, actor, action, target, detail, prev_hash, hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
    [r.seq, r.time, r.actor, r.action, r.target ?? null, r.detail ? JSON.stringify(r.detail) : null, r.prevHash, r.hash],
  );
}

/** Переносит прежний файловый журнал в пустую таблицу, предварительно проверив цепочку. */
export async function importAudit(db: Db, chain: AuditRecord[]): Promise<number> {
  const v = verifyChain(chain);
  if (!v.ok) throw new Error(`Файловый журнал не прошёл проверку (запись ${v.brokenAt}): ${v.reason}`);
  const existing = await db.query<{ n: string | number }>("SELECT count(*) AS n FROM audit_log");
  if (Number(existing.rows[0].n) !== 0) throw new Error("Журнал в базе не пуст: перенос возможен только в пустую таблицу");
  await db.transaction(async (tx) => { for (const r of chain) await appendAuditRow(tx, r); });
  return chain.length;
}

/**
 * Последовательная запись журнала в базу. Если запись не удалась, журнал помечается нарушенным и сервер перестаёт
 * обслуживать запросы (действие без следа в журнале недопустимо), пока администратор не разберётся.
 */
export class AuditWriter {
  private tail: Promise<void> = Promise.resolve();
  failed: Error | null = null;
  constructor(private db: Db) {}
  write = (r: AuditRecord): Promise<void> => {
    this.tail = this.tail.then(async () => {
      if (this.failed) return; // после сбоя новые записи не пишем: в цепочке уже дыра
      try { await appendAuditRow(this.db, r); } catch (e) { this.failed = e instanceof Error ? e : new Error(String(e)); throw this.failed; }
    });
    return this.tail;
  };
  flush = () => this.tail.catch(() => {});
}
