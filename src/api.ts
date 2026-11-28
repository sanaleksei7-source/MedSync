import { Capacitor } from "@capacitor/core";

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

/**
 * Два режима работы с сервером:
 *  - браузер: сессия в HttpOnly-cookie, JavaScript её не видит, запросы идут на тот же адрес;
 *  - приложение (Capacitor, шаг 4.1): страница открыта с https://localhost внутри телефона, сервер — по адресу VITE_API_BASE,
 *    вход по токенам (короткий access + одноразовый refresh). Токены пока только в памяти: после закрытия приложения
 *    нужно войти снова. Хранилище Keystore/Keychain и блокировка приложения — шаг 4.2.
 */
export const NATIVE = Capacitor.isNativePlatform();
const BASE = NATIVE ? (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "") : "";
let tokens: { access: string; refresh: string } | null = null;
let refreshing: Promise<boolean> | null = null;

type Init = { method: "GET" | "POST"; headers: Record<string, string>; body?: BodyInit };

async function refreshTokens(): Promise<boolean> {
  if (!tokens) return false;
  refreshing ??= (async () => {
    try {
      const r = await fetch(`${BASE}/api/token/refresh`, { method: "POST", credentials: "omit", headers: { "Content-Type": "application/json", "X-Requested-With": "medsync" }, body: JSON.stringify({ refreshToken: tokens?.refresh }) });
      if (!r.ok) { tokens = null; return false; }
      const d = (await r.json()) as { accessToken: string; refreshToken: string };
      tokens = { access: d.accessToken, refresh: d.refreshToken };
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function send(path: string, init: Init): Promise<Response> {
  if (!NATIVE) return fetch(path, { ...init, credentials: "same-origin" });
  const go = () => fetch(BASE + path, { ...init, credentials: "omit", headers: { ...init.headers, ...(tokens ? { Authorization: `Bearer ${tokens.access}` } : {}) } });
  const r = await go();
  // access-токен живёт 5 минут: при 401 один раз обновляем его и повторяем запрос
  if (r.status === 401 && tokens && path !== "/api/login" && (await refreshTokens())) return go();
  return r;
}

async function parse<T>(r: Response): Promise<T> {
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, (data as { error?: string } | null)?.error ?? `Ошибка ${r.status}`, data);
  return data as T;
}

/** Запрос к API. Заголовок X-Requested-With обязателен для POST. */
export async function api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const payload = NATIVE && path === "/api/login" && body && typeof body === "object" ? { ...body, client: "app" } : body;
  const r = await send(path, {
    method,
    headers: {
      ...(payload !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method === "POST" ? { "X-Requested-With": "medsync" } : {}),
    },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  const data = await parse<T>(r);
  if (NATIVE) {
    if (path === "/api/login") {
      const d = data as T & { accessToken?: string; refreshToken?: string };
      if (d.accessToken && d.refreshToken) tokens = { access: d.accessToken, refresh: d.refreshToken };
      delete d.accessToken; delete d.refreshToken; // экранам токены не нужны
      delete (d as { expiresIn?: number }).expiresIn;
    }
    if (path === "/api/logout") tokens = null;
  }
  return data;
}

/** Отправка звука (PCM 16 кГц, Int16) на распознавание. */
export async function apiAudio<T = { text: string; words?: { w: string; p: number }[]; dropped?: string }>(path: string, pcm: Int16Array, extraHeaders: Record<string, string> = {}): Promise<T> {
  const bytes = new Uint8Array(pcm.byteLength);
  bytes.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  const r = await send(path, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-Requested-With": "medsync", "X-Sample-Rate": "16000", ...extraHeaders },
    body: bytes,
  });
  return parse<T>(r);
}

/** Сбросить токены (выход, «войдите заново» после смены пароля). */
export const forgetSession = () => { tokens = null; };

export interface Me {
  id: string;
  name: string;
  role: "doctor" | "admin" | "auditor";
  /** Что нужно сделать до начала работы: сменить одноразовый пароль, затем заново подключить второй фактор. */
  setup?: "password" | "totp" | null;
}
