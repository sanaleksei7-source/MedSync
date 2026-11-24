import { cases } from "./cases";
import { checkCase } from "./check";

const c = cases[0];
const good = [{ title: "Объективно", statements: [{ text: "Температура 37,8 °C.", sourceIds: [2] }] }];
const bad = [{ title: "Диагноз", statements: [{ text: "ОРВИ.", sourceIds: [] }] }];
const t: [string, boolean][] = [
  ["good output passes", checkCase(c, good).length === 0],
  ["invented diagnosis caught", checkCase(c, bad).some((p) => p.includes("forbidden"))],
  ["missing fact caught", checkCase(c, bad).some((p) => p.includes("missing"))],
  ["cases well-formed", cases.every((x) => x.lines.length > 0 && x.sectionTitles.length > 0 && (x.mustContain?.length || x.mustNotContain?.length))],
  ["unique names", new Set(cases.map((x) => x.name)).size === cases.length],
  ["line ids unique per case", cases.every((x) => new Set(x.lines.map((l) => l.id)).size === x.lines.length)],
];
let n = 0;
for (const [name, ok] of t) if (!ok) { n++; console.error("FAIL", name); }
console.log(n ? `BAD eval (${n})` : `ok eval (${t.length}, ${cases.length} model cases)`);
if (n) process.exit(1);
