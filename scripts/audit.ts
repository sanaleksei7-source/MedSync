// Журнал аудита: npm run audit:status | audit:anchor -- <файл> | audit:check -- <файл>
//
//   status  проверяет цепочку в базе, показывает размер, самую раннюю запись и сколько записей старше срока хранения.
//   anchor  записывает «якорь» (номер и хэш последней записи) в новый файл. Файл кладут во внешнее хранилище,
//           где его нельзя изменить; существующий файл не перезаписывается.
//   check   сверяет журнал в базе с ранее сохранённым якорем: покажет, если журнал урезали или переписали.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { anchorOf, checkAnchor, retentionReport, verifyChain, type Anchor } from "../server/audit";
import { loadAudit } from "../server/db/audit-store";
import { openFromEnv } from "../server/db/db";
import { migrate } from "../server/db/migrate";

const [cmd, arg] = process.argv.slice(2);
if (!["status", "anchor", "check"].includes(cmd ?? "") || (cmd !== "status" && !arg)) {
  console.error("Команды: status | anchor <файл> | check <файл>");
  process.exit(2);
}
const years = Number(process.env.AUDIT_RETENTION_YEARS ?? 5); // предварительно: срок хранения определит юрист (docs/LEGAL_QUESTIONS_RU.md)

const db = await openFromEnv(process.env);
try {
  await migrate(db);
  const chain = await loadAudit(db);
  const v = verifyChain(chain);
  if (cmd === "status") {
    const r = retentionReport(chain, new Date(), years);
    console.log(`Записей: ${chain.length}. Самая ранняя: ${r.oldest ?? "—"}. Цепочка: ${v.ok ? "цела" : `НАРУШЕНА на записи ${v.brokenAt}: ${v.reason}`}`);
    console.log(`Срок хранения (предварительно): ${years} лет. Старше срока: ${r.pastRetention}. Автоматически записи не удаляются; удаление возможно только отдельной процедурой с решением владельца и юриста.`);
    process.exitCode = v.ok ? 0 : 1;
  } else if (cmd === "anchor") {
    if (!v.ok) throw new Error(`Журнал нарушен, якорь не создан (запись ${v.brokenAt}: ${v.reason})`);
    const a = anchorOf(chain);
    if (!a) throw new Error("Журнал пуст, якорь создавать не из чего");
    if (existsSync(arg)) throw new Error(`Файл ${arg} уже существует, существующие якоря не перезаписываются`);
    writeFileSync(arg, JSON.stringify(a, null, 2) + String.fromCharCode(10), { flag: "wx" });
    console.log(`Якорь записан: ${arg} (запись ${a.seq}). Положите файл во внешнее хранилище, где его нельзя изменить.`);
  } else {
    if (!existsSync(arg)) throw new Error(`Файл ${arg} не найден`);
    const a = JSON.parse(readFileSync(arg, "utf-8")) as Anchor;
    if (!Number.isInteger(a.seq) || a.seq < 1 || typeof a.hash !== "string") throw new Error("Файл якоря не похож на якорь");
    const c = checkAnchor(chain, a);
    console.log(v.ok && c.ok ? `Журнал совпадает с якорем (запись ${a.seq}, ${a.time}).` : `ПРОБЛЕМА: ${!v.ok ? `цепочка нарушена на записи ${v.brokenAt}` : (c as { reason: string }).reason}`);
    process.exitCode = v.ok && c.ok ? 0 : 1;
  }
} catch (e) {
  console.error("Ошибка:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await db.close();
}
