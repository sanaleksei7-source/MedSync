// Шифрование медицинских полей перед записью в базу (AES-256-GCM). Шифрование диска и самой базы — отдельный слой
// на стороне хостинга (см. docs/DB_OPERATIONS.md); это второй слой: даже копия базы без ключа не раскрывает текст.
// Ключи хранятся вне базы и вне репозитория (переменная окружения / менеджер секретов).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface Keyring {
  current: string;
  keys: Record<string, Buffer>;
}

/** Формат: «id:base64,id:base64». Первый ключ — действующий, остальные нужны, чтобы читать старые записи после смены ключа. */
export function parseKeyring(spec: string | undefined): Keyring {
  if (!spec?.trim()) throw new Error("Не задан DATA_KEYS (ключи шифрования данных). Создайте: npm run db:setup");
  const keys: Record<string, Buffer> = {};
  let current = "";
  for (const part of spec.split(",")) {
    const [id, b64] = part.trim().split(":");
    if (!id || !/^[A-Za-z0-9_-]{1,32}$/.test(id) || !b64) throw new Error("DATA_KEYS: неверный формат (id:base64,…)");
    const key = Buffer.from(b64, "base64");
    if (key.length !== 32) throw new Error(`DATA_KEYS: ключ ${id} должен быть длиной 32 байта`);
    if (keys[id]) throw new Error(`DATA_KEYS: повторяется ключ ${id}`);
    keys[id] = key;
    current ||= id;
  }
  return { current, keys };
}

export const newKey = () => randomBytes(32).toString("base64");

/** nonce(12) | шифртекст | тег(16). AAD привязывает запись к её идентификатору и ключу: подмена строк местами не пройдёт. */
export function encrypt(ring: Keyring, plaintext: string, aad: string): { keyId: string; blob: Buffer } {
  const nonce = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", ring.keys[ring.current], nonce);
  c.setAAD(Buffer.from(`${aad}|${ring.current}`));
  const ct = Buffer.concat([c.update(plaintext, "utf-8"), c.final()]);
  return { keyId: ring.current, blob: Buffer.concat([nonce, ct, c.getAuthTag()]) };
}

export function decrypt(ring: Keyring, keyId: string, blob: Uint8Array, aad: string): string {
  const key = ring.keys[keyId];
  if (!key) throw new Error(`Нет ключа ${keyId} для расшифровки`);
  const b = Buffer.from(blob);
  if (b.length < 12 + 16) throw new Error("Повреждённые данные");
  const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  d.setAAD(Buffer.from(`${aad}|${keyId}`));
  d.setAuthTag(b.subarray(b.length - 16));
  try {
    return Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]).toString("utf-8");
  } catch {
    throw new Error("Данные не прошли проверку подлинности (повреждены, подменены или неверный ключ)");
  }
}
