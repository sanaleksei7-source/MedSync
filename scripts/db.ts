// Управление базой: npm run db:setup | db:status | db:backup -- <файл> | db:restore -- <файл> | db:drill
//
//   setup   создаёт ключ шифрования данных (DATA_KEYS) в .env, если его там ещё нет. Ключ не печатается.
//   status  применяет миграции и показывает состояние базы.
//   backup  выгружает зашифрованную копию в файл (существующий файл не перезаписывается).
//   restore восстанавливает копию в ПУСТУЮ базу и проверяет результат.
//   drill   проверка восстановления: копия текущей базы разворачивается во временную пустую и проверяется. Базу не меняет.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { patients } from "../src/data/patients";
import { exportBackup, parseBackup, restoreBackup, serializeBackup, verifyDatabase } from "../server/db/backup";
import { newKey, parseKeyring } from "../server/db/crypto";
import { openFromEnv, openPglite } from "../server/db/db";
import { migrate } from "../server/db/migrate";

const [cmd, arg] = process.argv.slice(2);
const usage = () => { console.error("Команды: setup | status | backup <файл> | restore <файл> | drill [файл]"); process.exit(2); };

if (cmd === "setup") {
  const env = existsSync(".env") ? readFileSync(".env", "utf-8") : "";
  if (/^DATA_KEYS=\S+/m.test(env)) {
    console.log("DATA_KEYS уже есть в .env, ничего не меняю.");
  } else {
    const line = `DATA_KEYS=k1:${newKey()}`;
    if (env === "") writeFileSync(".env", line + String.fromCharCode(10));
    else appendFileSync(".env", (env.endsWith(String.fromCharCode(10)) ? "" : String.fromCharCode(10)) + line + String.fromCharCode(10));
    console.log("Ключ шифрования данных создан и записан в .env (файл не попадает в Git).");
    console.log("ВАЖНО: сохраните этот ключ отдельно от копий базы (менеджер паролей, сейф). Без ключа зашифрованные данные не прочитать, и восстановить их невозможно.");
  }
  process.exit(0);
}

if (!cmd || !["status", "backup", "restore", "drill"].includes(cmd)) usage();

const ring = parseKeyring(process.env.DATA_KEYS);
const db = await openFromEnv(process.env);
try {
  const applied = await migrate(db);
  if (applied.length) console.log("Применены миграции:", applied.join(", "));

  if (cmd === "status") {
    const v = await verifyDatabase(db, ring, patients);
    console.log(`База: ${db.engine}. Приёмов: ${v.visits}, подписанных: ${v.signed}. Проблем целостности: ${v.problems.length}`);
    v.problems.forEach((p) => console.log("  -", p));
    process.exitCode = v.problems.length ? 1 : 0;
  }

  if (cmd === "backup") {
    if (!arg) usage();
    if (existsSync(arg)) throw new Error(`Файл ${arg} уже существует, существующие копии не перезаписываются`);
    const b = await exportBackup(db);
    writeFileSync(arg, serializeBackup(b), { flag: "wx" });
    console.log(`Копия записана: ${arg} (приёмов: ${b.visits.length}). Файл зашифрован ключом DATA_KEYS; храните его отдельно от ключа.`);
  }

  if (cmd === "restore") {
    if (!arg) usage();
    const r = await restoreBackup(db, parseBackup(readFileSync(arg, "utf-8")));
    const v = await verifyDatabase(db, ring, patients);
    console.log(`Восстановлено приёмов: ${r.visits}. Проверка целостности: ${v.problems.length === 0 ? "успешно" : "ЕСТЬ ПРОБЛЕМЫ"}`);
    v.problems.forEach((p) => console.log("  -", p));
    process.exitCode = v.problems.length ? 1 : 0;
  }

  if (cmd === "drill") {
    const started = Date.now();
    const backup = await exportBackup(db);
    const text = serializeBackup(backup);
    if (arg) writeFileSync(arg, text, { flag: "wx" });
    const scratch = await openPglite(); // временная пустая база в памяти
    try {
      const r = await restoreBackup(scratch, parseBackup(text));
      const v = await verifyDatabase(scratch, ring, patients);
      console.log(`Проверка восстановления: копия ${(text.length / 1024).toFixed(1)} КБ, восстановлено приёмов ${r.visits}, подписанных ${v.signed}, проблем целостности ${v.problems.length}, ${((Date.now() - started) / 1000).toFixed(1)} с.`);
      v.problems.forEach((p) => console.log("  -", p));
      console.log(v.problems.length === 0 && r.visits === (await db.query<{ n: string }>("SELECT count(*) AS n FROM visits")).rows[0].n * 1 ? "РЕЗУЛЬТАТ: копия пригодна для восстановления." : "РЕЗУЛЬТАТ: копия НЕ прошла проверку.");
      process.exitCode = v.problems.length === 0 ? 0 : 1;
    } finally {
      await scratch.close();
    }
  }
} catch (e) {
  console.error("Ошибка:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await db.close();
}
