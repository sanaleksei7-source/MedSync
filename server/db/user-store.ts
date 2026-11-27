// Хранение учётных записей в базе. Секреты второго фактора шифруются тем же ключом DATA_KEYS, что и приёмы,
// и привязаны к идентификатору пользователя: строку нельзя подставить под другую запись.
import { decrypt, encrypt, type Keyring } from "./crypto";
import type { Queryable } from "./db";
import type { UserRecord } from "../accounts";

interface Row {
  id: string; username: string; name: string; role: string; password_hash: string; assigned_patients: string;
  disabled: boolean; setup: string | null; password_changed_at: string | null; key_id: string; secrets: Uint8Array;
}

const aad = (id: string) => `user:${id}`;

export function rowToUser(ring: Keyring, r: Row): UserRecord {
  const s = JSON.parse(decrypt(ring, r.key_id, r.secrets, aad(r.id))) as { totpSecret: string; pendingTotp?: string };
  return {
    id: r.id, username: r.username, name: r.name, role: r.role as UserRecord["role"], passwordHash: r.password_hash,
    totpSecret: s.totpSecret, assignedPatients: JSON.parse(r.assigned_patients) as string[],
    ...(r.disabled ? { disabled: true } : {}),
    ...(r.setup ? { setup: r.setup as NonNullable<UserRecord["setup"]> } : {}),
    ...(s.pendingTotp ? { pendingTotp: s.pendingTotp } : {}),
    ...(r.password_changed_at ? { passwordChangedAt: r.password_changed_at } : {}),
  };
}

export async function loadUsers(db: Queryable, ring: Keyring): Promise<UserRecord[]> {
  return (await db.query<Row>("SELECT * FROM users ORDER BY username")).rows.map((r) => rowToUser(ring, r));
}

/** Создаёт или обновляет запись целиком. */
export async function saveUser(db: Queryable, ring: Keyring, u: UserRecord): Promise<void> {
  const { keyId, blob } = encrypt(ring, JSON.stringify({ totpSecret: u.totpSecret, ...(u.pendingTotp ? { pendingTotp: u.pendingTotp } : {}) }), aad(u.id));
  await db.query(
    `INSERT INTO users (id, username, name, role, password_hash, assigned_patients, disabled, setup, password_changed_at, key_id, secrets)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO UPDATE SET username=$2, name=$3, role=$4, password_hash=$5, assigned_patients=$6, disabled=$7, setup=$8,
       password_changed_at=$9, key_id=$10, secrets=$11, updated_at=now()`,
    [u.id, u.username.toLowerCase(), u.name, u.role, u.passwordHash, JSON.stringify(u.assignedPatients), u.disabled === true, u.setup ?? null, u.passwordChangedAt ?? null, keyId, blob],
  );
}

/** Переносит пользователей из прежнего файла data/users.json в пустую таблицу. */
export async function importUsers(db: Queryable, ring: Keyring, list: UserRecord[]): Promise<number> {
  const n = Number((await db.query<{ n: string | number }>("SELECT count(*) AS n FROM users")).rows[0].n);
  if (n !== 0) throw new Error("Таблица пользователей не пуста: перенос возможен только в пустую");
  for (const u of list) await saveUser(db, ring, u);
  return list.length;
}
