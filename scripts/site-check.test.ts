// Тесты правил проверки сайта и того, что deploy/Caddyfile им соответствует.
import { readFileSync } from "node:fs";
import { evaluateApi, evaluatePage, hstsOk, verdict } from "./site-check-lib";
import { apiSecurityHeaders } from "../server/net";

const t: [string, boolean][] = [];
const check = (n: string, ok: boolean) => t.push([n, ok]);

// заголовки страницы берём прямо из deploy/Caddyfile, чтобы файл и проверка не разошлись
const caddy = readFileSync("deploy/Caddyfile", "utf-8");
const hdr = (name: string) => new RegExp(`\\n\\s*${name} "([^"]+)"`).exec(caddy)?.[1];
const pageHeaders = Object.fromEntries(["Strict-Transport-Security", "Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"].map((n) => [n, hdr(n)]));
const page = evaluatePage(pageHeaders);
check("deploy/Caddyfile headers pass every page rule", page.every((f) => f.ok));
check("Caddyfile removes Server header, limits TLS to 1.2/1.3, caps API body, proxies only to localhost", /-Server/.test(caddy) && /protocols tls1\.2 tls1\.3/.test(caddy) && /max_size 2MB/.test(caddy) && /reverse_proxy 127\.0\.0\.1:8787/.test(caddy) && !/reverse_proxy [^1]/.test(caddy));
check("CSP has no unsafe-inline anywhere", !/unsafe-inline|unsafe-eval/.test(caddy));
check("API headers from the server pass the API rules", evaluateApi(401, { ...apiSecurityHeaders(true), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }).every((f) => f.ok));
check("without HSTS the API check fails", !evaluateApi(401, { ...apiSecurityHeaders(false), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }).every((f) => f.ok));

check("HSTS: half a year is the minimum", hstsOk("max-age=31536000; includeSubDomains") && hstsOk("max-age=15552000") && !hstsOk("max-age=86400") && !hstsOk(undefined));
const bad = evaluatePage({ "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'", "Server": "nginx/1.18.0" });
check("unsafe-inline scripts, missing HSTS, missing frame-ancestors and a versioned Server header are caught", ["CSP: скрипты", "HSTS", "frame-ancestors", "версию"].every((k) => bad.some((f) => !f.ok && f.name.includes(k))));
check("verdict: critical failure → F, only warnings → B, all ok → A", verdict(bad).grade === "F" && verdict([{ name: "x", ok: false, critical: false }]).grade === "B" && verdict(page).grade === "A");
check("API answering 200 without login is critical", verdict(evaluateApi(200, { ...apiSecurityHeaders(true), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" })).grade === "F");

let badN = 0;
for (const [n, ok] of t) { console.log(ok ? "ok " : "FAIL", n); if (!ok) badN++; }
if (badN) process.exit(1);
console.log(`ok site-check (${t.length})`);
