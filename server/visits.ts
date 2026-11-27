// Приёмы на стороне сервера (шаг 3.1). Расшифровка, черновик и решения врача живут здесь;
// подпись берёт текст отсюда, а не из запроса. Хранилище вынесено в интерфейс: сейчас оно в памяти,
// на шаге 3.2 его заменит PostgreSQL без изменения остального кода.
import { createHash, randomBytes } from "node:crypto";
import { findConflicts } from "../src/data/allergy";
import { docs, transcript as demoTranscript, type DocType, type Line, type Section } from "../src/data/script";
import type { Patient, VisitSummary } from "../src/domain/patient";
import { finalizeSections, keyOf, signBlockers, type Action, type Decisions } from "../src/domain/rules";
import type { ChangeEntry, LineChange, LineOp, SignedInfo, VisitView } from "../src/domain/visit";

export const MAX_LINES = 400;
export const MAX_TEXT = 2000;
export const MAX_CHANGES = 50;
export const MAX_LOG = 1000;
export const MAX_OPEN_PER_USER = 50;
export const MAX_LINE_LOG = 5000;

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
  /** Кто, когда и как менял реплики расшифровки. Хранится вместе с приёмом (зашифровано) и после подписи не меняется. */
  lineLog: LineChange[];
  createdAt: string;
  updatedAt: string;
  signed?: SignedInfo;
  /** Сколько раз приём сохранялся. Нужен, чтобы два одновременных запроса не затёрли друг друга. */
  version: number;
}

/** Приём изменился с момента, когда его прочитали (например, два запроса подписи одновременно). */
export class VersionConflictError extends Error {
  constructor() { super("Приём изменился, обновите страницу"); }
}

export interface VisitStore {
  get(id: string): Promise<Visit | undefined>;
  /** Сохраняет приём; при успехе увеличивает v.version. Если в хранилище версия другая — VersionConflictError. */
  save(v: Visit): Promise<void>;
  countDrafts(ownerId: string): Promise<number>;
  /** Приёмы одного врача, новые сверху (не больше limit). */
  listByOwner(ownerId: string, limit: number): Promise<Visit[]>;
}

export class MemoryVisitStore implements VisitStore {
  private visits = new Map<string, Visit>();
  // Хранилище отдаёт и принимает копии, как база данных: изменения без save() не сохраняются.
  async get(id: string) { const v = this.visits.get(id); return v ? structuredClone(v) : undefined; }
  async save(v: Visit) {
    const stored = this.visits.get(v.id);
    if ((stored?.version ?? 0) !== v.version) throw new VersionConflictError();
    if (stored?.status === "signed") throw new VersionConflictError();
    v.version += 1;
    this.visits.set(v.id, structuredClone(v));
  }
  async countDrafts(ownerId: string) {
    let n = 0;
    for (const v of this.visits.values()) if (v.ownerId === ownerId && v.status === "draft") n++;
    return n;
  }
  async listByOwner(ownerId: string, limit: number) {
    return [...this.visits.values()]
      .filter((v) => v.ownerId === ownerId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .slice(0, limit)
      .map((v) => structuredClone(v));
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
    lineLog: [],
    createdAt: now,
    updatedAt: now,
    version: 0,
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

/** Хэш итогового текста документа: из данных приёма, которые держит сервер. Им же сверяется резервная копия. */
export function documentHash(v: Visit, patient: Patient): string {
  const final = finalizeSections(v.sections ?? [], v.decisions);
  const canonical = [docs[v.docType].title, patient.pin, ...final.flatMap((s) => [s.title, ...s.lines])].join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

export function toView(v: Visit, patient: Patient): VisitView {
  return {
    id: v.id, patientId: v.patientId,
    patient: { id: patient.id, name: patient.name, birthDate: patient.birthDate, pin: patient.pin, allergies: patient.allergies }, docType: v.docType, source: v.source, status: v.status,
    lines: v.lines, sections: v.sections, decisions: v.decisions, ackAllergy: v.ackAllergy, changeLog: v.changeLog, lineLog: v.lineLog,
    ...(v.signed ? { signed: v.signed } : {}),
  };
}

/** Строка истории: без текста разговора и документа. */
export function toSummary(v: Visit, patient: Patient): VisitSummary {
  return {
    id: v.id, patientId: v.patientId, patientName: patient.name, docType: v.docType, source: v.source, status: v.status,
    hasDraft: v.sections !== null, updatedAt: v.updatedAt,
    ...(v.signed ? { signedAt: v.signed.signedAt } : {}),
  };
}

// ---- история правок расшифровки (шаг 3.6) ----

/** Изменение расшифровки делает прежний черновик и решения врача недействительными: факты ссылались на старый текст. */
function resetDraft(v: Visit) {
  v.sections = null; v.decisions = {}; v.ackAllergy = [];
}

/** Разница между прежней и новой расшифровкой, по номерам реплик. */
export function diffLines(before: Line[], after: Line[], actor: string, time: string): LineChange[] {
  const old = new Map(before.map((l) => [l.id, l]));
  const out: LineChange[] = [];
  for (const l of after) {
    const o = old.get(l.id);
    if (!o) out.push({ time, actor, lineId: l.id, op: "add", after: l.text });
    else {
      if (o.speaker !== l.speaker) out.push({ time, actor, lineId: l.id, op: "speaker", before: o.speaker, after: l.speaker });
      if (o.text !== l.text) out.push({ time, actor, lineId: l.id, op: "edit", before: o.text, after: l.text });
    }
  }
  const next = new Set(after.map((l) => l.id));
  for (const o of before) if (!next.has(o.id)) out.push({ time, actor, lineId: o.id, op: "delete", before: o.text });
  return out.sort((a, b) => a.lineId - b.lineId);
}

/** Полная замена расшифровки (прежний путь). Каждое отличие попадает в историю. */
export function replaceLines(v: Visit, lines: Line[], actor: string, time: string): LineChange[] | string {
  const changes = diffLines(v.lines, lines, actor, time);
  if (v.lineLog.length + changes.length > MAX_LINE_LOG) return "Слишком много правок расшифровки";
  if (changes.length === 0) return changes;
  v.lines = lines; v.lineLog = [...v.lineLog, ...changes]; v.updatedAt = time;
  resetDraft(v);
  return changes;
}

/** Реплика, распознанная сервером из звука. Её исходный текст сохраняется, чтобы потом было видно, что поправил врач. */
export function appendAsrLine(v: Visit, speaker: Line["speaker"], text: string, actor: string, time: string): Line | string {
  if (v.lines.length >= MAX_LINES) return "Слишком длинная расшифровка";
  if (v.lineLog.length >= MAX_LINE_LOG) return "Слишком много правок расшифровки";
  const line: Line = { id: v.lines.reduce((m, l) => Math.max(m, l.id), 0) + 1, speaker, text: text.trim().slice(0, MAX_TEXT) };
  v.lines = [...v.lines, line];
  v.lineLog = [...v.lineLog, { time, actor, lineId: line.id, op: "asr", after: line.text }];
  v.updatedAt = time;
  resetDraft(v);
  return line;
}

const isSpeaker = (x: unknown): x is Line["speaker"] => x === "Врач" || x === "Пациент";
const okText = (x: unknown): x is string => typeof x === "string" && x.trim() !== "" && x.length <= MAX_TEXT;

/**
 * Точечные правки врача: edit (текст), speaker (кто говорит), delete, add (новая реплика вручную).
 * Всё или ничего: при любой ошибке приём не меняется. Возвращает список изменений или текст ошибки.
 */
export function applyLineOps(v: Visit, ops: unknown, actor: string, time: string): LineChange[] | string {
  if (!Array.isArray(ops) || ops.length === 0 || ops.length > MAX_CHANGES) return "Неверные данные запроса";
  const lines = v.lines.map((l) => ({ ...l }));
  const changes: LineChange[] = [];
  let nextId = lines.reduce((m, l) => Math.max(m, l.id), 0) + 1;
  for (const raw of ops) {
    if (!raw || typeof raw !== "object") return "Неверные данные запроса";
    const o = raw as { op?: unknown; id?: unknown; text?: unknown; speaker?: unknown };
    const op = o.op as LineOp;
    if (op === "add") {
      if (!okText(o.text) || !isSpeaker(o.speaker)) return "Неверные данные запроса";
      if (lines.length >= MAX_LINES) return "Слишком длинная расшифровка";
      const l = { id: nextId++, speaker: o.speaker, text: o.text.trim() };
      lines.push(l);
      changes.push({ time, actor, lineId: l.id, op: "add", after: l.text });
      continue;
    }
    const i = lines.findIndex((l) => l.id === o.id);
    if (i < 0) return "Нет такой реплики";
    const cur = lines[i];
    if (op === "edit") {
      if (!okText(o.text)) return "Неверные данные запроса";
      const text = o.text.trim();
      if (text !== cur.text) { changes.push({ time, actor, lineId: cur.id, op: "edit", before: cur.text, after: text }); cur.text = text; }
    } else if (op === "speaker") {
      if (!isSpeaker(o.speaker)) return "Неверные данные запроса";
      if (o.speaker !== cur.speaker) { changes.push({ time, actor, lineId: cur.id, op: "speaker", before: cur.speaker, after: o.speaker }); cur.speaker = o.speaker; }
    } else if (op === "delete") {
      changes.push({ time, actor, lineId: cur.id, op: "delete", before: cur.text });
      lines.splice(i, 1);
    } else return "Неверные данные запроса";
  }
  if (v.lineLog.length + changes.length > MAX_LINE_LOG) return "Слишком много правок расшифровки";
  if (changes.length === 0) return changes;
  v.lines = lines; v.lineLog = [...v.lineLog, ...changes]; v.updatedAt = time;
  resetDraft(v);
  return changes;
}

