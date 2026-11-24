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

export interface Me {
  id: string;
  name: string;
  role: "doctor" | "admin" | "auditor";
}
