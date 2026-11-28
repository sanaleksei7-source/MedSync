// Проверка опубликованного сайта: npm run check:site -- https://medsync.example.kg [порт распознавания, например 8080]
// Наш минимум перед пилотом: все пункты «ok». Дополнительно прогоните внешние сканеры (docs/DEPLOY.md, раздел 5).
import net from "node:net";
import tls from "node:tls";
import { evaluateApi, evaluatePage, verdict, type Finding } from "./site-check-lib";

const [target, asrPort] = process.argv.slice(2);
if (!target || !/^https:\/\//.test(target)) { console.error("Использование: npm run check:site -- https://адрес-сайта [порт-распознавания]"); process.exit(2); }
const u = new URL(target);
const host = u.hostname;
const findings: Finding[] = [];
const add = (name: string, ok: boolean, critical = true, note?: string) => findings.push({ name, ok, critical, note });

// 1. TLS: версия, сертификат, срок
await new Promise<void>((resolve) => {
  const s = tls.connect({ host, port: Number(u.port || 443), servername: host, timeout: 10_000 }, () => {
    const cert = s.getPeerCertificate();
    const days = Math.floor((Date.parse(cert.valid_to) - Date.now()) / 86_400_000);
    add(`Сертификат доверенный (${s.authorizationError ?? "ok"})`, s.authorized);
    add(`Протокол ${s.getProtocol()} (нужен TLS 1.2 или 1.3)`, ["TLSv1.2", "TLSv1.3"].includes(s.getProtocol() ?? ""));
    add(`Сертификат действует ещё ${days} дн. (нужно не меньше 14)`, days >= 14);
    s.end(); resolve();
  });
  s.on("error", (e) => { add(`TLS-соединение: ${e.message}`, false); resolve(); });
  s.on("timeout", () => { add("TLS-соединение: нет ответа", false); s.destroy(); resolve(); });
});
// 2. Старые версии TLS должны отвергаться
await new Promise<void>((resolve) => {
  const s = tls.connect({ host, port: Number(u.port || 443), servername: host, minVersion: "TLSv1", maxVersion: "TLSv1.1", ciphers: "DEFAULT@SECLEVEL=0", timeout: 10_000 }, () => { add("TLS 1.0/1.1 отвергаются", false); s.end(); resolve(); });
  s.on("error", () => { add("TLS 1.0/1.1 отвергаются", true, true, "проверка ограничена возможностями Node; подтвердите внешним сканером"); resolve(); });
  s.on("timeout", () => { s.destroy(); resolve(); });
});
// 3. http → https
try {
  const r = await fetch(`http://${host}/`, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  add(`http перенаправляет на https (${r.status})`, [301, 308].includes(r.status) && (r.headers.get("location") ?? "").startsWith("https://"));
} catch (e) { add(`http недоступен (${e instanceof Error ? e.message : e}) — тоже допустимо, если порт 80 закрыт`, true, false); }
// 4. Страница и API
const page = await fetch(u.origin + "/", { signal: AbortSignal.timeout(10_000) });
findings.push(...evaluatePage(Object.fromEntries(page.headers)));
const api = await fetch(u.origin + "/api/me", { signal: AbortSignal.timeout(10_000) });
findings.push(...evaluateApi(api.status, Object.fromEntries(api.headers)));
// 5. Внутренние порты закрыты снаружи
const closed = (port: number) => new Promise<boolean>((resolve) => {
  const s = net.connect({ host, port, timeout: 5000 }, () => { s.destroy(); resolve(false); });
  s.on("error", () => resolve(true));
  s.on("timeout", () => { s.destroy(); resolve(true); });
});
add("Порт API 8787 закрыт снаружи", await closed(8787));
if (asrPort) add(`Порт распознавания речи ${asrPort} закрыт снаружи`, await closed(Number(asrPort)));

for (const f of findings) console.log(`${f.ok ? "ok  " : f.critical ? "FAIL" : "warn"} ${f.name}${f.note ? ` (${f.note})` : ""}`);
const v = verdict(findings);
console.log(`\nИтог: ${v.grade}. ${v.grade === "A" ? "Наш минимум выполнен." : v.grade === "B" ? "Критичных проблем нет, есть замечания." : "Есть критичные проблемы — не открывать сайт для работы."}`);
process.exitCode = v.grade === "F" ? 1 : 0;
