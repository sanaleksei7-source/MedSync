// Вспомогательные функции для запуска по локальной сети (npm run dev:lan). Без побочных эффектов, чтобы их можно было проверить тестом.
import type { NetworkInterfaceInfo } from "node:os";

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function parseIpv4(s: string): number[] | null {
  const m = IPV4.exec(s);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

/** Только частные адреса домашней или офисной сети. Публичный адрес в сертификат не попадёт. */
export function isPrivateIpv4(s: string): boolean {
  const p = parseIpv4(s);
  if (!p) return false;
  return p[0] === 10 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31);
}

/** Выбирает адрес компьютера в локальной сети; 192.168.x.x предпочтительнее остальных. */
export function pickLanIp(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string | null {
  const found: string[] = [];
  for (const list of Object.values(ifaces))
    for (const i of list ?? []) if (i.family === "IPv4" && !i.internal && isPrivateIpv4(i.address)) found.push(i.address);
  return found.find((a) => a.startsWith("192.168.")) ?? found[0] ?? null;
}
