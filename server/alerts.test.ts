// Тесты правил оповещения о необычном доступе.
import { AlertMonitor, DEFAULT_ALERTS } from "./alerts";

const t: [string, boolean][] = [];
const check = (name: string, ok: boolean) => t.push([name, ok]);
// 2026-11-27 10:00 по Бишкеку (UTC+6) = 04:00 UTC — рабочее время
const at = (min: number, sec = 0) => new Date(Date.UTC(2026, 10, 27, 4, min, sec)).toISOString();
const ev = (min: number, action: string, actor = "doc1", detail?: Record<string, string | number | boolean>) => ({ time: at(min), actor, action, ...(detail ? { detail } : {}) });

{
  const m = new AlertMonitor();
  const out = [0, 1, 2, 3, 4].flatMap((i) => m.observe(ev(i, "visit.denied")));
  check("5 denials in 10 minutes raise one alert", out.length === 1 && out[0].rule === "denied.burst" && out[0].key === "doc1");
  check("denials by another user are counted separately", new AlertMonitor().observe(ev(0, "visit.denied", "doc2")).length === 0);
  check("the same alert is not repeated during the cooldown", m.observe(ev(5, "visit.denied")).length === 0 && m.observe(ev(6, "visit.denied")).length === 0);
  check("after the cooldown it can fire again", [20, 21, 22, 23, 24].flatMap((i) => m.observe(ev(i, "visit.denied"))).length === 1);
}
{
  const m = new AlertMonitor();
  const out = [0, 4, 8, 12, 16].flatMap((i) => m.observe(ev(i, "visit.denied")));
  check("slow denials spread over a long time do not alert", out.length === 0);
}
{
  const m = new AlertMonitor();
  const out = Array.from({ length: 10 }, (_, i) => m.observe(ev(0, "login.fail", "anonymous", { user: "doc1" }))).flat();
  check("10 failed logins for one account raise an alert", out.length === 1 && out[0].rule === "login.fail.burst" && out[0].key === "doc1");
  check("failed logins for different accounts are separate", Array.from({ length: 9 }, () => new AlertMonitor().observe(ev(0, "login.fail", "anonymous", { user: "x" }))).flat().length === 0);
}
check("refresh token reuse alerts at once", new AlertMonitor().observe(ev(0, "token.reuse")).some((a) => a.rule === "token.reuse"));
{
  const m = new AlertMonitor();
  const out = Array.from({ length: DEFAULT_ALERTS.readLimit }, (_, i) => m.observe({ time: at(0, i % 60), actor: "doc1", action: i % 2 ? "visit.read" : "patient.list" })).flat();
  check("mass reading raises an alert at the limit", out.length === 1 && out[0].rule === "read.burst");
  check("a normal day of reading does not", Array.from({ length: 99 }, (_, i) => new AlertMonitor().observe(ev(i % 10, "visit.read"))).flat().length === 0);
}
{
  const night = new Date(Date.UTC(2026, 10, 27, 18, 30)).toISOString(); // 00:30 по Бишкеку
  const a = new AlertMonitor().observe({ time: night, actor: "doc1", action: "visit.read" });
  check("patient data access at night raises an alert", a.length === 1 && a[0].rule === "off.hours");
  check("login at night is not patient data access", new AlertMonitor().observe({ time: night, actor: "doc1", action: "login.ok" }).length === 0);
  const edge = new AlertMonitor().observe({ time: new Date(Date.UTC(2026, 10, 27, 16, 0)).toISOString(), actor: "doc1", action: "visit.read" }); // 22:00
  check("22:00 is already outside working hours, 06:00 is inside", edge.length === 1 && new AlertMonitor().observe({ time: new Date(Date.UTC(2026, 10, 27, 0, 0)).toISOString(), actor: "doc1", action: "visit.read" }).length === 0);
}
check("alerts and system records never raise alerts", new AlertMonitor().observe({ time: at(0), actor: "system", action: "alert.denied.burst" }).length === 0 && new AlertMonitor().observe(ev(0, "alert.read.burst")).length === 0);
check("an unreadable time is ignored", new AlertMonitor().observe({ time: "not a date", actor: "doc1", action: "visit.denied" }).length === 0);

let bad = 0;
for (const [n, ok] of t) if (!ok) { bad++; console.error("FAIL", n); }
console.log(bad ? `BAD alerts (${bad}/${t.length})` : `ok alerts (${t.length})`);
process.exit(bad ? 1 : 0);
