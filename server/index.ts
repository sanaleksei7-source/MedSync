import http from "node:http";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { createHandler, type UserRecord } from "./app";
import { LoginThrottle, SessionStore, hashPassword } from "./auth";
import { parseLines, toLine, type AuditRecord } from "./audit";
import { DEFAULT_ORIGINS } from "./guards";
import { extractDraft } from "./llm";
import { DemoSigner } from "./signer";
import { engineFromEnv } from "./asr/engine";

const USERS_FILE = "data/users.json";
const AUDIT_FILE = "data/audit.log";

if (!existsSync(USERS_FILE)) {
  console.error("Нет data/users.json. Создайте вымышленных пользователей: npm run seed");
  process.exit(1);
}
const users = JSON.parse(readFileSync(USERS_FILE, "utf-8")) as UserRecord[];
const audit: AuditRecord[] = existsSync(AUDIT_FILE) ? parseLines(readFileSync(AUDIT_FILE, "utf-8")) : [];

// Ключ читается из переменной окружения ANTHROPIC_API_KEY (файл .env, не коммитится).
const client = new Anthropic();
const asr = engineFromEnv(process.env); // падает при небезопасном ASR_URL: аудио не должно уходить за пределы клиники
console.log(asr ? `Распознавание речи: ${asr.name}` : "Распознавание речи не настроено (ASR_URL)");

const handler = createHandler({
  users,
  sessions: new SessionStore(),
  throttle: new LoginThrottle(),
  signer: new DemoSigner(process.env.SIGNING_DEMO_KEY),
  audit,
  asr,
  persistAudit: (r) => appendFileSync(AUDIT_FILE, toLine(r)),
  extract: (docTitle, sectionTitles, lines) => {
    if (!process.env.ANTHROPIC_API_KEY)
      throw new Error("Не задан ANTHROPIC_API_KEY. Создайте файл .env (см. README) и перезапустите сервер.");
    return extractDraft(client, docTitle, sectionTitles, lines);
  },
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",").map((o) => o.trim()) ?? DEFAULT_ORIGINS,
  secureCookie: process.env.NODE_ENV === "production",
  dummyHash: await hashPassword("dummy-password-for-timing"),
});

const server = http.createServer((req, res) => {
  handler(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Ошибка сервера" }));
  });
});
server.requestTimeout = 120_000;
server.listen(8787, "127.0.0.1", () => console.log("MedSync API on http://127.0.0.1:8787"));
