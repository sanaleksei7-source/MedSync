import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Заголовки безопасности. frame-ancestors и HSTS нельзя задать через <meta>,
// поэтому на реальном хостинге их нужно выставить на уровне веб-сервера (см. SECURITY_PLAN.md).
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

const headers = {
  "Content-Security-Policy": `${csp}; frame-ancestors 'none'`,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "microphone=(self), camera=(), geolocation=()",
};

// CSP в <meta> только для production-сборки: dev-сервер Vite использует inline-скрипты для HMR.
const cspMeta = (): Plugin => ({
  name: "csp-meta",
  apply: "build",
  transformIndexHtml: () => [
    { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: csp }, injectTo: "head-prepend" },
  ],
});

// Запуск для телефона в локальной сети (npm run dev:lan, scripts/dev-lan.ts): HTTPS с локальным сертификатом.
// Без DEV_HTTPS=1 поведение прежнее — только этот компьютер, обычный http.
const lan = process.env.DEV_HTTPS === "1" && process.env.DEV_CERT_DIR && process.env.DEV_LAN_IP
  ? { dir: process.env.DEV_CERT_DIR, ip: process.env.DEV_LAN_IP }
  : null;

export default defineConfig({
  plugins: [react(), tailwindcss(), cspMeta()],
  server: lan
    ? {
        https: { key: readFileSync(join(lan.dir, "server.key")), cert: readFileSync(join(lan.dir, "server.crt")) },
        allowedHosts: [lan.ip, "localhost", "127.0.0.1"], // при HTTPS Vite эту проверку не применяет; подмену имени и так не пропустит сертификат (он выдан только на этот адрес)
        // changeOrigin: API видит обращение с 127.0.0.1:8787, а Origin проверяется по ALLOWED_ORIGINS.
        proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: true } },
      }
    : { proxy: { "/api": "http://127.0.0.1:8787" } },
  preview: lan
    ? {
        headers,
        https: { key: readFileSync(join(lan.dir, "server.key")), cert: readFileSync(join(lan.dir, "server.crt")) },
        allowedHosts: [lan.ip, "localhost", "127.0.0.1"],
        proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: true } },
      }
    : { headers, proxy: { "/api": "http://127.0.0.1:8787" } },
});
