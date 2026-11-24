// Защитные проверки API. Это НЕ аутентификация врача (она появится вместе с настоящим входом, Фаза 1):
// они закрывают запросы с чужих сайтов и перебор/злоупотребление ключом модели.

export const DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

/** Браузерный запрос с чужого сайта несёт чужой Origin — отклоняем. Без Origin (curl, сервер) пропускаем. */
export function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  return origin === undefined || allowed.includes(origin);
}

export function hostAllowed(host: string | undefined): boolean {
  // Защита от DNS rebinding: сервер слушает только локальный адрес.
  return host === "127.0.0.1:8787" || host === "localhost:8787" || host === "localhost:5173" || host === "127.0.0.1:5173";
}

export function isJson(contentType: string | undefined): boolean {
  return !!contentType && contentType.toLowerCase().startsWith("application/json");
}

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
