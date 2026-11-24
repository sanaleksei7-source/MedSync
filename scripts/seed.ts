// Создаёт вымышленных пользователей для разработки: data/users.json и data/demo-credentials.txt.
// Оба файла в .gitignore. Пароли и секреты второго фактора случайные и показываются только в
// demo-credentials.txt, в консоль и в репозиторий они не попадают.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { hashPassword, newTotpSecret } from "../server/auth";
import type { UserRecord } from "../server/app";

if (existsSync("data/users.json") && process.argv[2] !== "--force") {
  console.error("data/users.json уже существует. Запустите с --force, чтобы пересоздать (старые пароли перестанут работать).");
  process.exit(1);
}

const defs: Omit<UserRecord, "passwordHash" | "totpSecret">[] = [
  { id: "u-doc1", username: "doctor1", name: "Асанов Б. Т. (демо)", role: "doctor", assignedPatients: ["p1", "p2"] },
  { id: "u-doc2", username: "doctor2", name: "Бекова А. К. (демо)", role: "doctor", assignedPatients: ["p3", "p4"] },
  { id: "u-adm", username: "admin1", name: "Администратор (демо)", role: "admin", assignedPatients: [] },
  { id: "u-aud", username: "auditor1", name: "Аудитор (демо)", role: "auditor", assignedPatients: [] },
];

const users: UserRecord[] = [];
const lines: string[] = ["ВЫМЫШЛЕННЫЕ учётные записи для разработки. Не коммитить, не пересылать.", ""];
for (const d of defs) {
  const password = randomBytes(15).toString("base64url");
  const totpSecret = newTotpSecret();
  users.push({ ...d, passwordHash: await hashPassword(password), totpSecret });
  lines.push(`${d.username} (${d.role})`, `  password: ${password}`, `  totp secret (base32): ${totpSecret}`, "");
}

mkdirSync("data", { recursive: true });
writeFileSync("data/users.json", JSON.stringify(users, null, 2));
writeFileSync("data/demo-credentials.txt", lines.join("\n"));
console.log(`Создано ${users.length} пользователей. Учётные данные: data/demo-credentials.txt`);
