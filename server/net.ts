// Работа за обратным прокси в интернете (шаг 3.7): настоящий адрес клиента, заголовки безопасности, метка адреса для журнала.
import { createHmac } from "node:crypto";
import type http from "node:http";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const IP = /^[0-9a-fA-F.:]{2,45}$/;

/**
 * Адрес клиента. За прокси все запросы приходят с 127.0.0.1, и ограничители по адресу считали бы всех клиентов одним.
 * Заголовку X-Forwarded-For верим, только если включено trustProxy И запрос пришёл с этого же компьютера (от прокси):
 * берётся последний адрес — тот, который дописал наш прокси; всё левее мог подставить сам клиент.
 */
export function clientIp(req: http.IncomingMessage, trustProxy: boolean): string {
  const remote = req.socket.remoteAddress ?? "unknown";
  if (!trustProxy || !LOOPBACK.has(remote)) return remote;
  const xff = req.headers["x-forwarded-for"];
  const raw = Array.isArray(xff) ? xff.join(",") : xff;
  const last = raw?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return last && IP.test(last) ? last : remote;
}

/** Метка адреса для журнала и тревог: по ней видно «тот же адрес», но сам адрес из неё не восстановить без ключа сервера. */
export const ipTag = (ip: string, key: string) => createHmac("sha256", key).update(ip).digest("hex").slice(0, 16);

/** Заголовки для ответов API. Страницы приложения отдаёт прокси со своими заголовками (deploy/Caddyfile). */
export function apiSecurityHeaders(hsts: boolean): Record<string, string> {
  return {
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    ...(hsts ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
  };
}
