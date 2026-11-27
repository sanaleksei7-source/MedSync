// Шаг 3.3: данных пациентов нет ни в коде браузера (src/), ни в публичных файлах (public/).
// Они лежат только на сервере и отдаются после входа врачу, за которым пациент закреплён.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { patients } from "../server/patients";

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const textFile = /\.(tsx?|css|html|json|webmanifest|svg|js|md)$/i;
const test = /\.test\.tsx?$/;
const files = [...walk("src"), ...walk("public"), "index.html"].filter((f) => textFile.test(f) && !test.test(f));

let bad = 0;
const t: [string, boolean][] = [];
const check = (name: string, ok: boolean) => t.push([name, ok]);

const needles = patients.flatMap((p) => [p.name, p.name.split(" ")[0], p.pin, p.birthDate]);
let leaks = 0;
for (const f of files) {
  const s = readFileSync(f, "utf-8");
  for (const n of needles) if (s.includes(n)) { leaks++; console.error(`patient data in browser files: ${f} contains "${n}"`); }
}
check("no patient names, PINs or birth dates in src/ or public/", leaks === 0);

let imports = 0;
for (const f of files.filter((x) => /\.tsx?$/.test(x))) {
  const s = readFileSync(f, "utf-8");
  if (/from\s+["'][^"']*server\//.test(s)) { imports++; console.error(`browser file imports server code: ${f}`); }
}
check("browser code does not import server code", imports === 0);
check("the server has patients to serve", patients.length > 0);

for (const [name, ok] of t) { console.log(ok ? "ok " : "FAIL", name); if (!ok) bad++; }
if (bad) process.exit(1);
console.log(`${t.length} checks passed`);
