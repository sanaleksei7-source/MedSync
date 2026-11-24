import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { OUTPUT_SCHEMA, SYSTEM_PROMPT, buildUserPrompt, sanitize } from "./extract";
import type { Line } from "../src/data/script";

// Ключ читается из переменной окружения ANTHROPIC_API_KEY (файл .env, не коммитится).
const client = new Anthropic();
const MODEL = "claude-opus-5-5";
const MAX_LINES = 400;

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
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
  if (req.method !== "POST" || req.url !== "/api/extract") return json(res, 404, { error: "Not found" });
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

    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildUserPrompt(docTitle, sectionTitles, lines) }],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);

    if (response.stop_reason === "refusal") return json(res, 422, { error: "Модель отказалась обработать запрос" });
    if (response.stop_reason === "max_tokens") return json(res, 502, { error: "Ответ модели обрезан, попробуйте ещё раз" });
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return json(res, 502, { error: "Пустой ответ модели" });
    json(res, 200, { sections: sanitize(JSON.parse(text.text), lines, sectionTitles) });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Anthropic.AuthenticationError
      ? "Не задан или неверен ANTHROPIC_API_KEY"
      : e instanceof Anthropic.RateLimitError ? "Лимит запросов, повторите позже" : "Ошибка сервера";
    json(res, 500, { error: msg });
  }
});

server.listen(8787, "127.0.0.1", () => console.log("MedSync API on http://127.0.0.1:8787"));
