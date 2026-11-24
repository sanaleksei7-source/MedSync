import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_ORIGINS, RateLimiter, hostAllowed, isJson, originAllowed } from "./guards";
import { ModelRefusal, ModelTruncated, extractDraft } from "./llm";
import type { Line } from "../src/data/script";

// Ключ читается из переменной окружения ANTHROPIC_API_KEY (файл .env, не коммитится).
const client = new Anthropic();
const MAX_LINES = 400;
const ORIGINS = process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()) ?? DEFAULT_ORIGINS;
const limiter = new RateLimiter(10, 60_000); // 10 запросов в минуту с одного адреса

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_000_000) throw new Error("Слишком большой запрос");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

const server = http.createServer(async (req, res) => {
  if (!hostAllowed(req.headers.host)) return json(res, 403, { error: "Forbidden" });
  if (req.method !== "POST" || req.url !== "/api/extract") return json(res, 404, { error: "Not found" });
  if (!originAllowed(req.headers.origin, ORIGINS)) return json(res, 403, { error: "Forbidden" });
  if (!isJson(req.headers["content-type"])) return json(res, 415, { error: "Нужен Content-Type: application/json" });
  if (!limiter.allow(req.socket.remoteAddress ?? "unknown")) return json(res, 429, { error: "Слишком много запросов, подождите минуту" });
  if (!process.env.ANTHROPIC_API_KEY)
    return json(res, 503, { error: "Не задан ANTHROPIC_API_KEY. Создайте файл .env (см. README) и перезапустите сервер." });
  try {
    const body = JSON.parse(await readBody(req));
    const { docTitle, sectionTitles, lines } = body as { docTitle: string; sectionTitles: string[]; lines: Line[] };
    if (
      typeof docTitle !== "string" ||
      !Array.isArray(sectionTitles) || !sectionTitles.every((t) => typeof t === "string") ||
      !Array.isArray(lines) || lines.length === 0 || lines.length > MAX_LINES ||
      !lines.every((l) => Number.isInteger(l.id) && typeof l.text === "string" && (l.speaker === "Врач" || l.speaker === "Пациент"))
    ) return json(res, 400, { error: "Неверные данные запроса" });

    const sections = await extractDraft(client, docTitle, sectionTitles, lines);
    json(res, 200, { sections });
  } catch (e) {
    console.error(e);
    if (e instanceof ModelRefusal) return json(res, 422, { error: "Модель отказалась обработать запрос" });
    if (e instanceof ModelTruncated) return json(res, 502, { error: "Ответ модели обрезан, попробуйте ещё раз" });
    const msg = e instanceof Anthropic.AuthenticationError
      ? "Не задан или неверен ANTHROPIC_API_KEY"
      : e instanceof Anthropic.RateLimitError ? "Лимит запросов, повторите позже" : "Ошибка сервера";
    json(res, 500, { error: msg });
  }
});

server.requestTimeout = 120_000;
server.listen(8787, "127.0.0.1", () => console.log("MedSync API on http://127.0.0.1:8787"));
