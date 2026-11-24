// Ищет в отслеживаемых git-файлах то, чего там быть не должно:
// ключи API, приватные ключи и ПИН, не относящиеся к вымышленным демо-пациентам.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { patients } from "../src/data/patients";

const demoPins = new Set(patients.map((p) => p.pin));
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf-8" }).split("\0").filter(Boolean);
const skip = /(^|\/)(package-lock\.json|.*\.(png|jpe?g|ico|woff2?))$/i;

const rules: { name: string; re: RegExp; allow?: (m: string) => boolean }[] = [
  { name: "Anthropic API key", re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "Private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "Possible real ПИН (14 digits, valid date)", re: /(?<!\d)[12]\d{13}(?!\d)/g, allow: (m) => demoPins.has(m) || !validDate(m) },
];

function validDate(pin: string): boolean {
  const d = +pin.slice(1, 3), mo = +pin.slice(3, 5), y = +pin.slice(5, 9);
  return y >= 1900 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
}

let bad = 0;
for (const f of files) {
  if (skip.test(f)) continue;
  let text: string;
  try { text = readFileSync(f, "utf-8"); } catch { continue; }
  for (const r of rules) {
    for (const m of text.matchAll(r.re)) {
      if (r.allow?.(m[0])) continue;
      bad++;
      console.error(`${r.name}: ${f}`);
    }
  }
}
if (bad) { console.error(`scan failed: ${bad} finding(s)`); process.exit(1); }
console.log(`scan ok (${files.length} files)`);
