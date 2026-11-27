// Журнал аудита с хэш-цепочкой: каждая запись включает хэш предыдущей, поэтому
// изменение или вырезание записи задним числом ломает проверку.
// В журнал пишутся только идентификаторы и типы действий. Медицинского содержимого,
// ФИО и ПИН в журнале быть не должно.
import { createHash } from "node:crypto";

export interface AuditEvent {
  time: string;
  actor: string; // id пользователя или "anonymous"
  action: string; // например "login.ok", "document.sign"
  target?: string; // id объекта (пациента, документа)
  detail?: Record<string, string | number | boolean>;
}

export interface AuditRecord extends AuditEvent {
  seq: number;
  prevHash: string;
  hash: string;
}

export const GENESIS = "0".repeat(64);

export function hashRecord(e: AuditEvent, seq: number, prevHash: string): string {
  return createHash("sha256")
    .update(JSON.stringify([seq, prevHash, e.time, e.actor, e.action, e.target ?? null, e.detail ?? null]))
    .digest("hex");
}

export function appendRecord(chain: AuditRecord[], e: AuditEvent): AuditRecord {
  const prev = chain[chain.length - 1];
  const seq = prev ? prev.seq + 1 : 1;
  const prevHash = prev ? prev.hash : GENESIS;
  const rec: AuditRecord = { ...e, seq, prevHash, hash: hashRecord(e, seq, prevHash) };
  chain.push(rec);
  return rec;
}

export type VerifyResult = { ok: true; count: number } | { ok: false; brokenAt: number; reason: string };

export function verifyChain(chain: AuditRecord[]): VerifyResult {
  let prevHash = GENESIS;
  for (let i = 0; i < chain.length; i++) {
    const r = chain[i];
    if (r.seq !== i + 1) return { ok: false, brokenAt: i + 1, reason: "нарушена нумерация (запись вырезана или добавлена)" };
    if (r.prevHash !== prevHash) return { ok: false, brokenAt: r.seq, reason: "нарушена связь с предыдущей записью" };
    if (hashRecord(r, r.seq, r.prevHash) !== r.hash) return { ok: false, brokenAt: r.seq, reason: "содержимое записи изменено" };
    prevHash = r.hash;
  }
  return { ok: true, count: chain.length };
}

/** Сериализация в JSON Lines: одна запись на строку, файл только дописывается. */
export const toLine = (r: AuditRecord) => JSON.stringify(r) + "\n";
export const parseLines = (text: string): AuditRecord[] =>
  text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as AuditRecord);

/**
 * Якорь — «отпечаток» журнала на момент времени (номер и хэш последней записи). Его кладут во внешнее хранилище, где
 * запись нельзя изменить (шаг 3.7 и хостинг). Если журнал потом урезали или переписали целиком вместе с цепочкой, якорь это покажет.
 */
export interface Anchor { seq: number; hash: string; time: string }

export const anchorOf = (chain: AuditRecord[], now = new Date()): Anchor | null => {
  const last = chain[chain.length - 1];
  return last ? { seq: last.seq, hash: last.hash, time: now.toISOString() } : null;
};

export function checkAnchor(chain: AuditRecord[], a: Anchor): { ok: true } | { ok: false; reason: string } {
  if (chain.length < a.seq) return { ok: false, reason: `журнал короче якоря: в нём ${chain.length} записей, якорь на ${a.seq} (записи вырезаны)` };
  if (chain[a.seq - 1].hash !== a.hash) return { ok: false, reason: `запись ${a.seq} не совпадает с якорем (журнал переписан)` };
  return { ok: true };
}

/** Срок хранения записей журнала. Сами записи автоматически не удаляются: таблица только дописывается. */
export function retentionReport(chain: AuditRecord[], now: Date, years: number): { oldest: string | null; pastRetention: number } {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return { oldest: chain[0]?.time ?? null, pastRetention: chain.filter((r) => Date.parse(r.time) < cutoff.getTime()).length };
}
