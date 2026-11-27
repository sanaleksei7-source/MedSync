// Приёмы на стороне сервера (шаг 3.1). Расшифровка, черновик и решения врача живут здесь;
// подпись берёт текст отсюда, а не из запроса. Хранилище вынесено в интерфейс: сейчас оно в памяти,
// на шаге 3.2 его заменит PostgreSQL без изменения остального кода.
import { randomBytes } from "node:crypto";
import { findConflicts } from "../src/data/allergy";
import { docs, transcript as demoTranscript, type DocType, type Line, type Section } from "../src/data/script";
import type { Patient } from "../src/data/patients";
import { keyOf, signBlockers, type Action, type Decisions } from "../src/domain/rules";
import type { ChangeEntry, SignedInfo, VisitView } from "../src/domain/visit";

export const MAX_LINES = 400;
export const MAX_TEXT = 2000;
export const MAX_CHANGES = 50;
export const MAX_LOG = 1000;
export const MAX_OPEN_PER_USER = 50;

export interface Visit {
  id: string;
  ownerId: string;
  patientId: string;
  docType: DocType;
  source: "demo" | "live";
  status: "draft" | "signed";
  lines: Line[];
  sections: Section[] | null;
  decisions: Decisions;
  ackAllergy: number[];
  changeLog: ChangeEntry[];
  createdAt: string;
  updatedAt: string;
  signed?: SignedInfo;
}

export interface VisitStore {
  get(id: string): Visit | undefined;
  save(v: Visit): void;
  countDrafts(ownerId: string): number;
}

export class MemoryVisitStore implements VisitStore {
  private visits = new Map<string, Visit>();
  get(id: string) { return this.visits.get(id); }
  save(v: Visit) { this.visits.set(v.id, v); }
  countDrafts(ownerId: string) {
    let n = 0;
    for (const v of this.visits.values()) if (v.ownerId === ownerId && v.status === "draft") n++;
    return n;
  }
}

export const VISIT_ID = /^[0-9a-f]{32}$/;
export const isDocType = (x: unknown): x is DocType => typeof x === "string" && Object.prototype.hasOwnProperty.call(docs, x);

export function createVisit(ownerId: string, patientId: string, docType: DocType, demo: boolean, now: string): Visit {
  return {
    id: randomBytes(16).toString("hex"),
    ownerId,
    patientId,
    docType,
    source: demo ? "demo" : "live",
    status: "draft",
    // Демо-разговор и шаблон документа берёт сам сервер, клиент их не присылает.
    lines: demo ? structuredClone(demoTranscript) : [],
    sections: demo ? structuredClone(docs[docType].sections) : null,
    decisions: {},
    ackAllergy: [],
    changeLog: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function parseLines(raw: unknown): Line[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_LINES) return null;
  const seen = new Set<number>();
  for (const l of raw) {
    if (!l || typeof l !== "object") return null;
    const { id, speaker, text } = l as Line;
    if (!Number.isInteger(id) || id < 1 || seen.has(id)) return null;
    if (speaker !== "Врач" && speaker !== "Пациент") return null;
    if (typeof text !== "string" || text.trim() === "" || text.length > MAX_TEXT) return null;
    seen.add(id);
  }
  return (raw as Line[]).map((l) => ({ id: l.id, speaker: l.speaker, text: l.text.trim() }));
}

/** Ссылки на несуществующие реплики не считаются источником: такой факт останется «без источника» и потребует решения врача. */
export function clampSections(sections: Section[], lines: Line[]): Section[] {
  const ids = new Set(lines.map((l) => l.id));
  return sections.map((s) => ({
    title: s.title,
    statements: s.statements.map((st) => ({ text: st.text, sourceIds: [...new Set(st.sourceIds)].filter((id) => ids.has(id)) })),
  }));
}

export interface ChangeRequest { key: string; action: Action; text?: string }

/** Применяет действия врача к приёму. Возвращает текст ошибки или null; при ошибке приём не меняется. */
export function applyChanges(v: Visit, patient: Patient, changes: unknown, ack: unknown, now: string): string | null {
  if (!v.sections) return "Черновик ещё не составлен";
  const list = changes === undefined ? [] : changes;
  const acks = ack === undefined ? [] : ack;
  if (!Array.isArray(list) || !Array.isArray(acks) || list.length + acks.length === 0 || list.length > MAX_CHANGES || acks.length > MAX_CHANGES) return "Неверные данные запроса";
  if (v.changeLog.length + list.length + acks.length > MAX_LOG) return "Слишком много изменений";

  const decisions: Decisions = { ...v.decisions };
  const log: ChangeEntry[] = [];
  for (const c of list as ChangeRequest[]) {
    if (!c || typeof c.key !== "string" || !/^\d{1,3}-\d{1,3}$/.test(c.key)) return "Неверные данные запроса";
    const [si, i] = c.key.split("-").map(Number);
    const st = v.sections[si]?.statements[i];
    if (!st || keyOf(si, i) !== c.key) return "Такого утверждения нет в документе";
    if (c.action !== "kept" && c.action !== "removed" && c.action !== "edited") return "Неверные данные запроса";
    if (c.action === "edited") {
      if (typeof c.text !== "string" || c.text.trim() === "" || c.text.length > MAX_TEXT) return "Неверные данные запроса";
      decisions[c.key] = { action: "edited", text: c.text.trim() };
      log.push({ time: now, action: "edited", before: st.text, after: c.text.trim() });
    } else {
      decisions[c.key] = { action: c.action };
      log.push({ time: now, action: c.action, before: st.text });
    }
  }
  const conflicts = findConflicts(patient.allergies, v.lines);
  const newAck = [...v.ackAllergy];
  for (const id of acks as unknown[]) {
    const conflict = conflicts.find((x) => x.lineId === id);
    if (typeof id !== "number" || !conflict) return "Такого конфликта с аллергией нет";
    if (!newAck.includes(id)) {
      newAck.push(id);
      log.push({ time: now, action: "kept", before: `Назначение «${conflict.drug}» при аллергии — подтверждено врачом` });
    }
  }
  v.decisions = decisions;
  v.ackAllergy = newAck;
  v.changeLog = [...v.changeLog, ...log];
  v.updatedAt = now;
  return null;
}

/** Что мешает подписать сейчас. Считается по данным сервера. */
export function blockersFor(v: Visit, patient: Patient) {
  return signBlockers(v.sections ?? [], v.decisions, findConflicts(patient.allergies, v.lines), v.ackAllergy, () => true);
}

export function toView(v: Visit): VisitView {
  return {
    id: v.id, patientId: v.patientId, docType: v.docType, source: v.source, status: v.status,
    lines: v.lines, sections: v.sections, decisions: v.decisions, ackAllergy: v.ackAllergy, changeLog: v.changeLog,
    ...(v.signed ? { signed: v.signed } : {}),
  };
}
