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

// ---- Токены для мобильных приложений ----
// Cookie в обёрнутом приложении не работает (страница с другого origin), поэтому приложение получает
// короткоживущий access-токен и одноразовый refresh-токен. Это отдельный вид сессии: токен не принимается
// вместо cookie и наоборот (см. app.ts). На сервере хранятся только SHA-256 хэши токенов.
export interface TokenPair { accessToken: string; refreshToken: string; expiresIn: number }
interface Family {
  userId: string;
  created: number;
  lastSeen: number;
  refresh: string; // хэш действующего refresh-токена
  used: Set<string>; // хэши уже использованных refresh-токенов — их повтор означает кражу
  access: string; // хэш действующего access-токена
}

export class TokenStore {
  private families = new Map<string, Family>();
  private accessIndex = new Map<string, { family: string; expires: number }>();
  private refreshIndex = new Map<string, string>(); // хэш refresh-токена → id семьи
  /** accessMs — срок жизни access-токена; idleMs — сколько можно не пользоваться приложением; absoluteMs — потолок для одного входа. */
  constructor(private accessMs = 5 * 60_000, private idleMs = 5 * 60_000, private absoluteMs = 8 * 3_600_000) {}
  private static h = (t: string) => createHash("sha256").update(t).digest("hex");

  private mint(familyId: string, f: Family, now: number): TokenPair {
    const accessToken = randomBytes(32).toString("base64url");
    const refreshToken = randomBytes(32).toString("base64url");
    this.accessIndex.delete(f.access);
    f.access = TokenStore.h(accessToken);
    this.accessIndex.set(f.access, { family: familyId, expires: now + this.accessMs });
    f.used.add(f.refresh);
    f.refresh = TokenStore.h(refreshToken);
    this.refreshIndex.set(f.refresh, familyId);
    f.lastSeen = now;
    return { accessToken, refreshToken, expiresIn: Math.floor(this.accessMs / 1000) };
  }

  issue(userId: string, now = Date.now()): TokenPair {
    const familyId = randomBytes(16).toString("hex");
    const f: Family = { userId, created: now, lastSeen: now, refresh: "", used: new Set(), access: "" };
    this.families.set(familyId, f);
    const pair = this.mint(familyId, f, now);
    f.used.delete(""); // у первого выпуска предыдущего refresh-токена нет
    return pair;
  }

  private alive(f: Family, now: number) {
    return now - f.lastSeen <= this.idleMs && now - f.created <= this.absoluteMs;
  }

  /** Проверяет access-токен. Возвращает пользователя и id семьи (нужен для выхода). */
  authenticate(token: string | undefined, now = Date.now()): { userId: string; family: string } | null {
    if (!token) return null;
    const a = this.accessIndex.get(TokenStore.h(token));
    if (!a) return null;
    const f = this.families.get(a.family);
    if (!f) return null;
    if (now > a.expires) return null; // истёк access-токен — нужен refresh
    if (!this.alive(f, now)) { this.revoke(a.family); return null; }
    f.lastSeen = now;
    return { userId: f.userId, family: a.family };
  }

  /** Меняет refresh-токен на новую пару. Повторное использование старого токена отзывает весь вход. */
  refresh(token: string | undefined, now = Date.now()): { pair: TokenPair; userId: string } | { reuse: true; userId: string } | null {
    if (!token) return null;
    const hash = TokenStore.h(token);
    const familyId = this.refreshIndex.get(hash);
    if (!familyId) return null;
    const f = this.families.get(familyId);
    if (!f) { this.refreshIndex.delete(hash); return null; }
    if (hash !== f.refresh) { // старый токен предъявлен повторно
      const userId = f.userId;
      this.revoke(familyId);
      return { reuse: true, userId };
    }
    if (!this.alive(f, now)) { this.revoke(familyId); return null; }
    return { pair: this.mint(familyId, f, now), userId: f.userId };
  }

  revoke(familyId: string) {
    const f = this.families.get(familyId);
    if (!f) return;
    this.accessIndex.delete(f.access);
    this.refreshIndex.delete(f.refresh);
    for (const u of f.used) this.refreshIndex.delete(u);
    this.families.delete(familyId); // отзывается только этот вход
  }

  /** Отзывает все входы пользователя (например, при утере телефона). */
  revokeUser(userId: string) {
    for (const [id, f] of [...this.families]) if (f.userId === userId) this.revoke(id);
  }
}
