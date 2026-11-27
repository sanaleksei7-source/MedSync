// Миграции схемы: файлы server/db/migrations/NNNN_name.sql применяются по порядку, каждая в своей транзакции.
// В таблице schema_migrations хранится контрольная сумма: применённую миграцию править нельзя, нужна новая.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Db } from "./db";

const DIR = fileURLToPath(new URL("./migrations/", import.meta.url));
const NAME = /^\d{4}_[a-z0-9_]+\.sql$/;

export interface Migration { name: string; sql: string; sha256: string }

export function loadMigrations(dir = DIR): Migration[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => {
      if (!NAME.test(name)) throw new Error(`Неверное имя миграции: ${name}`);
      const sql = readFileSync(dir + name, "utf-8");
      return { name, sql, sha256: createHash("sha256").update(sql).digest("hex") };
    });
}

export async function migrate(db: Db, migrations = loadMigrations()): Promise<string[]> {
  await db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Map((await db.query<{ name: string; sha256: string }>("SELECT name, sha256 FROM schema_migrations")).rows.map((r) => [r.name, r.sha256]));
  const applied: string[] = [];
  for (const m of migrations) {
    const prev = done.get(m.name);
    if (prev) {
      if (prev !== m.sha256) throw new Error(`Миграция ${m.name} изменена после применения. Добавьте новую миграцию.`);
      continue;
    }
    // Имя и сумма проверены выше (шаблон имени и hex), поэтому подставляются в текст без риска.
    try {
      await db.exec(`BEGIN;\n${m.sql}\nINSERT INTO schema_migrations (name, sha256) VALUES ('${m.name}', '${m.sha256}');\nCOMMIT;`);
    } catch (e) {
      await db.exec("ROLLBACK").catch(() => {});
      throw e;
    }
    applied.push(m.name);
  }
  return applied;
}
