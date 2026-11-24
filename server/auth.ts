// ПРОТОТИП аутентификации на вымышленных пользователях. Перед реальным использованием
// требует независимого аудита (см. SECURITY_PLAN.md, Фаза 3) и, возможно, государственной
// системы идентификации вместо собственных паролей.
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Пароль короче ${MIN_PASSWORD_LENGTH} символов`);
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltHex, hashHex] = stored.split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---- TOTP (RFC 6238, SHA-1, 6 цифр, шаг 30 с) ----
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function newTotpSecret(): string {
  const bytes = randomBytes(20);
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function b32decode(s: string): Buffer {
  let bits = "";
  for (const c of s.toUpperCase()) {
    const v = B32.indexOf(c);
    if (v < 0) throw new Error("bad base32");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function totpAt(secret: string, timeMs: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 30_000)));
  const h = createHmac("sha1", b32decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1_000_000).padStart(6, "0");
}

/** Допускает смещение часов на один шаг в обе стороны. */
export function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return [-1, 0, 1].some((d) => {
    const expected = Buffer.from(totpAt(secret, now + d * 30_000));
    return timingSafeEqual(expected, Buffer.from(code));
  });
}

// ---- Блокировка перебора (по имени пользователя) ----
export class LoginThrottle {
  private fails = new Map<string, number[]>();
  constructor(private max = 5, private windowMs = 15 * 60_000) {}
  private recent(key: string, now: number) {
    const r = (this.fails.get(key) ?? []).filter((t) => now - t < this.windowMs);
    this.fails.set(key, r);
    return r;
  }
  locked(key: string, now = Date.now()): boolean {
    return this.recent(key, now).length >= this.max;
  }
  fail(key: string, now = Date.now()) {
    this.recent(key, now).push(now);
  }
  reset(key: string) {
    this.fails.delete(key);
  }
}

// ---- Сессии: на сервере хранится только хэш токена ----
export interface Session { userId: string; created: number; lastSeen: number }

export class SessionStore {
  private sessions = new Map<string, Session>();
  constructor(private idleMs = 15 * 60_000, private absoluteMs = 8 * 3_600_000) {}
  private static h = (t: string) => createHash("sha256").update(t).digest("hex");

  create(userId: string, now = Date.now()): string {
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(SessionStore.h(token), { userId, created: now, lastSeen: now });
    return token;
  }
  get(token: string | undefined, now = Date.now()): Session | null {
    if (!token) return null;
    const key = SessionStore.h(token);
    const s = this.sessions.get(key);
    if (!s) return null;
    if (now - s.lastSeen > this.idleMs || now - s.created > this.absoluteMs) {
      this.sessions.delete(key); // удаляется только эта просроченная сессия
      return null;
    }
    s.lastSeen = now;
    return s;
  }
  destroy(token: string | undefined) {
    if (token) this.sessions.delete(SessionStore.h(token)); // выход завершает только эту сессию
  }
}
