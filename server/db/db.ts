// Тонкий слой над PostgreSQL. Один интерфейс, два движка:
//  - PGlite — настоящий Postgres внутри Node (разработка, тесты, небольшие стенды), данные в папке или в памяти;
//  - pg     — обычное подключение к серверу PostgreSQL (DATABASE_URL), так будет в рабочей среде.
// Остальной код не знает, какой движок под ним.
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Несколько команд подряд, без параметров (миграции). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /** Всё внутри — одна транзакция: либо применяется целиком, либо откатывается (восстановление из копии, миграции данных). */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  readonly engine: "pglite" | "pg";
}

export async function openPglite(dataDir?: string): Promise<Db> {
  const db = new PGlite(dataDir); // без пути — только в памяти
  await db.waitReady;
  return {
    engine: "pglite",
    query: async (sql, params) => ({ rows: (await db.query(sql, params as unknown[])).rows as never[] }),
    exec: async (sql) => { await db.exec(sql); },
    transaction: (fn) =>
      db.transaction((tx) =>
        fn({
          query: async (sql, params) => ({ rows: (await tx.query(sql, params as unknown[])).rows as never[] }),
          exec: async (sql) => { await tx.exec(sql); },
        }),
      ),
    close: () => db.close(),
  };
}

export async function openPg(connectionString: string): Promise<Db> {
  // В рабочей среде соединение с базой должно быть защищено TLS: добавьте sslmode=verify-full в DATABASE_URL.
  const pool = new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  pool.on("error", (e) => console.error("Ошибка соединения с базой:", e.message));
  await pool.query("SELECT 1");
  return {
    engine: "pg",
    query: async (sql, params) => ({ rows: (await pool.query(sql, params as unknown[])).rows as never[] }),
    exec: async (sql) => { await pool.query(sql); },
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn({
          query: async (sql, params) => ({ rows: (await client.query(sql, params as unknown[])).rows as never[] }),
          exec: async (sql) => { await client.query(sql); },
        });
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/**
 * База из переменных окружения: DATABASE_URL — сервер PostgreSQL; иначе встроенный PGlite в папке DB_DIR (по умолчанию data/db).
 * Папка data/ не попадает в Git.
 */
export async function openFromEnv(env: NodeJS.ProcessEnv): Promise<Db> {
  if (env.DATABASE_URL) return openPg(env.DATABASE_URL);
  return openPglite(env.DB_DIR ?? "data/db");
}
