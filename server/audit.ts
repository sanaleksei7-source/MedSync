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
