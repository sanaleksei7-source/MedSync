import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { createHandler, type UserRecord } from "./app";
import { LoginThrottle, SessionStore, TokenStore, hashPassword } from "./auth";
import { parseLines, verifyChain } from "./audit";
import { DEFAULT_ORIGINS } from "./guards";
import { extractDraft } from "./llm";
import { DemoSigner } from "./signer";
import { engineFromEnv } from "./asr/engine";
import { parseKeyring } from "./db/crypto";
import { openFromEnv } from "./db/db";
import { migrate } from "./db/migrate";
import { PgVisitStore } from "./db/visit-store";
import { AuditWriter, importAudit, loadAudit } from "./db/audit-store";
import { importUsers, loadUsers, saveUser } from "./db/user-store";

const USERS_FILE = "data/users.json";
const AUDIT_FILE = "data/audit.log";


// Ключ читается из переменной окружения ANTHROPIC_API_KEY (файл .env, не коммитится).
const client = new Anthropic();
const asr = engineFromEnv(process.env); // падает при небезопасном ASR_URL: аудио не должно уходить за пределы клиники
console.log(asr ? `Распознавание речи: ${asr.name}` : "Распознавание речи не настроено (ASR_URL)");

// База: DATABASE_URL (сервер PostgreSQL) или встроенная в папке data/db. Медицинский текст шифруется ключом DATA_KEYS (npm run db:setup).
const db = await openFromEnv(process.env);
const applied = await migrate(db);
if (applied.length) console.log("Применены миграции базы:", applied.join(", "));
console.log(`База данных: ${db.engine}`);

// Журнал аудита лежит в таблице, которая только дописывается. Прежний файл data/audit.log один раз переносится в неё.
let audit = await loadAudit(db);
if (audit.length === 0 && existsSync(AUDIT_FILE)) {
  const n = await importAudit(db, parseLines(readFileSync(AUDIT_FILE, "utf-8")));
  console.log(`Журнал аудита перенесён из ${AUDIT_FILE} в базу: ${n} записей (файл оставлен как есть).`);
  audit = await loadAudit(db);
}
const chainCheck = verifyChain(audit);
if (!chainCheck.ok) {
  console.error(`Журнал аудита в базе нарушен (запись ${chainCheck.brokenAt}): ${chainCheck.reason}. Сервер не запущен.`);
  process.exit(1);
}
const auditWriter = new AuditWriter(db);

// Учётные записи лежат в таблице users (секреты второго фактора зашифрованы). Прежний файл data/users.json один раз переносится в неё.
const ring = parseKeyring(process.env.DATA_KEYS);
let users = await loadUsers(db, ring);
if (users.length === 0) {
  if (!existsSync(USERS_FILE)) {
    console.error("Нет пользователей. Создайте вымышленных: npm run seed (файл data/users.json перенесётся в базу при запуске).");
    process.exit(1);
  }
  const n = await importUsers(db, ring, JSON.parse(readFileSync(USERS_FILE, "utf-8")) as UserRecord[]);
  console.log(`Пользователи перенесены из ${USERS_FILE} в базу: ${n} (файл оставлен как есть; после проверки его лучше убрать, в нём хэши паролей и секреты).`);
  users = await loadUsers(db, ring);
}

const handler = createHandler({
  users,
  sessions: new SessionStore(),
  visits: new PgVisitStore(db, ring),
  tokens: new TokenStore(),
  appOrigins: process.env.APP_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean) ?? [],
  throttle: new LoginThrottle(),
  signer: new DemoSigner(process.env.SIGNING_DEMO_KEY),
  audit,
  asr,
  persistAudit: auditWriter.write,
  persistUser: (u) => saveUser(db, ring, u),
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
