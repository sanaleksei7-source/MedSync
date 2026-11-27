// Управление учётными записями: правила паролей, одноразовые пароли, ссылка для приложения-аутентификатора.
import { randomBytes } from "node:crypto";
import { MIN_PASSWORD_LENGTH } from "./auth";
import type { Role } from "./rbac";

/** Что нужно сделать пользователю при следующем входе, прежде чем пользоваться системой. */
export type SetupStep = "password" | "totp";

export interface UserRecord {
  id: string;
  username: string;
  name: string;
  role: Role;
  passwordHash: string;
  totpSecret: string;
  assignedPatients: string[];
  disabled?: boolean;
  /** Одноразовый пароль или секрет выданы администратором: пользователь обязан сменить пароль, затем заново подключить второй фактор. */
  setup?: SetupStep;
  /** Новый секрет второго фактора, ожидающий подтверждения кодом. */
  pendingTotp?: string;
  passwordChangedAt?: string;
}

export const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;
export const ROLES: Role[] = ["doctor", "admin", "auditor"];

export function tempPassword(): string {
  return randomBytes(15).toString("base64url");
}

/** Возвращает текст ошибки или null. Правила: длина, не равен прежнему и не содержит имя пользователя; полный список запрещённых паролей нужен до рабочего запуска. */
export function passwordProblem(next: string, current: string, username: string): string | null {
  if (next.length < MIN_PASSWORD_LENGTH) return `Пароль короче ${MIN_PASSWORD_LENGTH} символов`;
  if (next.length > 256) return "Пароль слишком длинный";
  if (next === current) return "Новый пароль должен отличаться от прежнего";
  if (next.toLowerCase().includes(username.toLowerCase())) return "Пароль не должен содержать имя пользователя";
  if (/^(.)\1+$/.test(next)) return "Пароль слишком простой";
  return null;
}

/** Ссылка, которую понимают приложения-аутентификаторы (её можно показать QR-кодом). */
export const otpauthUri = (username: string, secret: string) =>
  `otpauth://totp/MedSync:${encodeURIComponent(username)}?secret=${secret}&issuer=MedSync&digits=6&period=30`;

/** Что видит администратор: без хэша пароля и секретов. */
export const publicUser = (u: UserRecord) => ({
  id: u.id, username: u.username, name: u.name, role: u.role, assignedPatients: u.assignedPatients,
  disabled: u.disabled === true, setup: u.setup ?? null,
});
