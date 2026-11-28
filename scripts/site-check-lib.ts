// Правила проверки опубликованного сайта (шаг 3.7). Чистые функции: заголовки на входе, список замечаний на выходе.
export interface Finding { name: string; ok: boolean; critical: boolean; note?: string }
type Headers = Record<string, string | undefined>;

const lower = (h: Headers) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
const directives = (csp: string) => new Map(csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => { const [n, ...v] = d.split(/\s+/); return [n.toLowerCase(), v] as const; }));

export function hstsOk(v: string | undefined): boolean {
  const m = /max-age=(\d+)/i.exec(v ?? "");
  return !!m && Number(m[1]) >= 15_552_000; // не меньше полугода
}

/** Заголовки страницы приложения. */
export function evaluatePage(raw: Headers): Finding[] {
  const h = lower(raw);
  const csp = h["content-security-policy"] ?? "";
  const d = directives(csp);
  const script = d.get("script-src") ?? d.get("default-src") ?? [];
  return [
    { name: "HSTS не меньше полугода", ok: hstsOk(h["strict-transport-security"]), critical: true },
    { name: "Есть Content-Security-Policy", ok: csp !== "", critical: true },
    { name: "CSP: скрипты только свои, без 'unsafe-inline' и 'unsafe-eval'", ok: script.length > 0 && !script.some((s) => /unsafe-inline|unsafe-eval|\*|data:|http:/.test(s)), critical: true },
    { name: "CSP: страницу нельзя встроить в чужой сайт (frame-ancestors 'none' или 'self')", ok: ["'none'", "'self'"].includes(d.get("frame-ancestors")?.[0] ?? ""), critical: true },
    { name: "CSP: object-src 'none' и base-uri ограничен", ok: (d.get("object-src")?.[0] ?? d.get("default-src")?.[0]) === "'none'" || (d.get("object-src")?.[0] === "'none'"), critical: false, note: "object-src" },
    { name: "X-Content-Type-Options: nosniff", ok: (h["x-content-type-options"] ?? "").toLowerCase() === "nosniff", critical: true },
    { name: "Referrer-Policy задан", ok: !!h["referrer-policy"], critical: false },
    { name: "Permissions-Policy: микрофон только этому сайту", ok: /microphone=\(self\)/.test(h["permissions-policy"] ?? ""), critical: false },
    { name: "Сервер не сообщает версию (Server, X-Powered-By)", ok: !h["x-powered-by"] && !/\d/.test(h["server"] ?? ""), critical: false },
  ];
}

/** Ответ API без входа. */
export function evaluateApi(status: number, raw: Headers): Finding[] {
  const h = lower(raw);
  return [
    { name: "API без входа отвечает 401", ok: status === 401, critical: true },
    { name: "API: Cache-Control no-store", ok: /no-store/.test(h["cache-control"] ?? ""), critical: true },
    { name: "API: HSTS", ok: hstsOk(h["strict-transport-security"]), critical: true },
    { name: "API: CSP default-src 'none'", ok: /default-src 'none'/.test(h["content-security-policy"] ?? ""), critical: false },
    { name: "API: nosniff", ok: (h["x-content-type-options"] ?? "").toLowerCase() === "nosniff", critical: true },
  ];
}

export function verdict(f: Finding[]): { grade: "A" | "B" | "F"; failed: Finding[] } {
  const failed = f.filter((x) => !x.ok);
  return { grade: failed.some((x) => x.critical) ? "F" : failed.length ? "B" : "A", failed };
}
