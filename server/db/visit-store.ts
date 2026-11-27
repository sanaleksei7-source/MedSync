// Хранилище приёмов в PostgreSQL. Медицинский текст (расшифровка, черновик, решения врача, журнал изменений, подпись)
// шифруется AES-256-GCM до записи и лежит в одном поле payload; открытыми остаются только служебные поля.
// Копия базы без ключей не раскрывает текст, а подмена или перестановка строк обнаруживается при чтении.
import { decrypt, encrypt, type Keyring } from "./crypto";
import type { Db } from "./db";
import { VersionConflictError, type Visit, type VisitStore } from "../visits";

type Payload = Pick<Visit, "lines" | "sections" | "decisions" | "ackAllergy" | "changeLog" | "signed">;

export interface VisitRow {
  id: string;
  owner_id: string;
  patient_id: string;
  doc_type: string;
  source: string;
  status: string;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
  signed_hash: string | null;
  key_id: string;
  payload: Uint8Array;
}

/** Привязка зашифрованных данных к приёму, врачу и пациенту: строку нельзя подставить под другим идентификатором или передать другому врачу. */
export const visitAad = (id: string, ownerId: string, patientId: string) => `visit:${id}:${ownerId}:${patientId}`;
const iso = (d: Date | string) => new Date(d).toISOString();
const isIntegrityError = (e: unknown) => typeof (e as { code?: unknown })?.code === "string" && (e as { code: string }).code.startsWith("23");

export function rowToVisit(ring: Keyring, r: VisitRow): Visit {
  const p = JSON.parse(decrypt(ring, r.key_id, r.payload, visitAad(r.id, r.owner_id, r.patient_id))) as Payload;
  // Открытые поля и зашифрованное содержимое должны совпадать: расхождение значит, что строку правили в обход программы.
  if ((p.signed?.hash ?? null) !== r.signed_hash) throw new Error(`Приём ${r.id}: подпись в данных не совпадает с базой`);
  return {
    id: r.id,
    ownerId: r.owner_id,
    patientId: r.patient_id,
    docType: r.doc_type as Visit["docType"],
    source: r.source as Visit["source"],
    status: r.status as Visit["status"],
    version: r.version,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    ...p,
  };
}

export class PgVisitStore implements VisitStore {
  constructor(private db: Db, private ring: Keyring) {}

  async get(id: string): Promise<Visit | undefined> {
    const { rows } = await this.db.query<VisitRow>("SELECT * FROM visits WHERE id = $1", [id]);
    return rows[0] ? rowToVisit(this.ring, rows[0]) : undefined;
  }

  async save(v: Visit): Promise<void> {
    const payload: Payload = { lines: v.lines, sections: v.sections, decisions: v.decisions, ackAllergy: v.ackAllergy, changeLog: v.changeLog, signed: v.signed };
    const { keyId, blob } = encrypt(this.ring, JSON.stringify(payload), visitAad(v.id, v.ownerId, v.patientId));
    try {
      if (v.version === 0) {
        await this.db.query(
          `INSERT INTO visits (id, owner_id, patient_id, doc_type, source, status, version, created_at, updated_at, signed_hash, key_id, payload)
           VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,$11)`,
          [v.id, v.ownerId, v.patientId, v.docType, v.source, v.status, v.createdAt, v.updatedAt, v.signed?.hash ?? null, keyId, blob],
        );
      } else {
        // Условие по версии: если приём успели изменить, строка не найдётся и мы отказываем, а не затираем чужую запись.
        const { rows } = await this.db.query<{ version: number }>(
          `UPDATE visits SET status=$3, version=version+1, updated_at=$4, signed_hash=$5, key_id=$6, payload=$7
           WHERE id=$1 AND version=$2 RETURNING version`,
          [v.id, v.version, v.status, v.updatedAt, v.signed?.hash ?? null, keyId, blob],
        );
        if (rows.length === 0) throw new VersionConflictError();
      }
    } catch (e) {
      // Дубликат id, правка подписанного приёма (триггер) и т. п. — это конфликт, а не сбой сервера.
      if (e instanceof VersionConflictError) throw e;
      if (isIntegrityError(e)) throw new VersionConflictError();
      throw e;
    }
    v.version += 1;
  }

  async countDrafts(ownerId: string): Promise<number> {
    const { rows } = await this.db.query<{ n: string | number }>("SELECT count(*) AS n FROM visits WHERE owner_id = $1 AND status = 'draft'", [ownerId]);
    return Number(rows[0]?.n ?? 0);
  }

  async listByOwner(ownerId: string, limit: number): Promise<Visit[]> {
    const { rows } = await this.db.query<VisitRow>("SELECT * FROM visits WHERE owner_id = $1 ORDER BY updated_at DESC, id LIMIT $2", [ownerId, limit]);
    return rows.map((r) => rowToVisit(this.ring, r));
  }
}
