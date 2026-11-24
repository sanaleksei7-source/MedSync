import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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

export default defineConfig({
  plugins: [react(), tailwindcss(), cspMeta()],
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
  preview: { headers, proxy: { "/api": "http://127.0.0.1:8787" } },
});
