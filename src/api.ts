export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

/** Запрос к API. Сессия хранится в HttpOnly-cookie, JS её не видит. Заголовок X-Requested-With обязателен для POST. */
export async function api<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method === "POST" ? { "X-Requested-With": "medsync" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, (data as { error?: string } | null)?.error ?? `Ошибка ${r.status}`, data);
  return data as T;
}

/** Отправка звука (PCM 16 кГц, Int16) на локальное распознавание. */
export async function apiAudio<T = { text: string; words?: { w: string; p: number }[]; dropped?: string }>(path: string, pcm: Int16Array, extraHeaders: Record<string, string> = {}): Promise<T> {
  const bytes = new Uint8Array(pcm.byteLength);
  bytes.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  const r = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/octet-stream", "X-Requested-With": "medsync", "X-Sample-Rate": "16000", ...extraHeaders },
    body: bytes,
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(r.status, (data as { error?: string } | null)?.error ?? `Ошибка ${r.status}`, data);
  return data as T;
}

export interface Me {
  id: string;
  name: string;
  role: "doctor" | "admin" | "auditor";
  /** Что нужно сделать до начала работы: сменить одноразовый пароль, затем заново подключить второй фактор. */
  setup?: "password" | "totp" | null;
}
