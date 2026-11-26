// Проверяет, помогают ли подсветка неуверенных слов и подсказки препаратов на реальных записях:
// какую долю ошибок модели они ловят и сколько ложных тревог дают.
//   ASR_URL=http://127.0.0.1:8080 npx tsx scripts/asr-flag-check.ts <папка с wav и txt>
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { HttpWhisperEngine, SAMPLE_RATE, wavToPcm, type AsrWord } from "../server/asr/engine";
import { normalize } from "../server/asr/metrics";
import { suggestDrug } from "../src/audio/suggest";
import { DRUG_LEXICON } from "../src/data/drugs";

const dir = process.argv[2];
const threshold = Number(process.env.THRESHOLD ?? 0.5);
if (!dir || !process.env.ASR_URL) {
  console.error("Использование: ASR_URL=... npx tsx scripts/asr-flag-check.ts <папка>");
  process.exit(1);
}
const engine = new HttpWhisperEngine(process.env.ASR_URL, false, true);
const CHUNK = 25 * SAMPLE_RATE;
const bag = (s: string) => {
  const m = new Map<string, number>();
  for (const w of normalize(s).split(" ").filter(Boolean)) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
};

let wrongTotal = 0, wrongFlagged = 0, rightTotal = 0, rightFlagged = 0, numbersTotal = 0, numbersWrong = 0;
let drugsInRef = 0, drugsCorrect = 0, drugsFixable = 0;
const allWordProbs: { p: number; wrong: boolean }[] = [];

for (const f of readdirSync(dir).filter((x) => x.endsWith(".wav") && !x.startsWith("silence")).sort()) {
  const refPath = join(dir, f.replace(/\.wav$/, ".txt"));
  if (!existsSync(refPath)) continue;
  const ref = readFileSync(refPath, "utf-8");
  const pcm = wavToPcm(readFileSync(join(dir, f)));
  const words: AsrWord[] = [];
  for (let i = 0; i < pcm.length; i += CHUNK) words.push(...((await engine.transcribe(pcm.subarray(i, i + CHUNK))).words ?? []));

  const refBag = bag(ref);
  const hypText = words.map((w) => w.w).join(" ");
  for (const w of words) {
    const key = normalize(w.w);
    if (!key) continue;
    const have = refBag.get(key) ?? 0;
    const wrong = have === 0;
    if (!wrong) refBag.set(key, have - 1);
    const flagged = w.p < threshold;
    allWordProbs.push({ p: w.p, wrong });
    if (wrong) { wrongTotal++; if (flagged) wrongFlagged++; } else { rightTotal++; if (flagged) rightFlagged++; }
    if (/\d/.test(w.w)) { numbersTotal++; if (wrong) numbersWrong++; }
  }

  // Препараты: правильно распознан, исправим подсказкой или потерян
  const refWords = normalize(ref).split(" ");
  const hypWords = normalize(hypText).split(" ");
  for (const drug of DRUG_LEXICON) {
    const stem = normalize(drug).slice(0, Math.max(6, Math.min(8, drug.length)));
    if (!refWords.some((w) => w.startsWith(stem))) continue;
    drugsInRef++;
    if (hypWords.some((w) => w.startsWith(stem))) drugsCorrect++;
    else if (words.some((w) => suggestDrug(w.w) === drug)) drugsFixable++;
  }
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)} %` : "н/д");
console.log(`Порог уверенности: ${threshold}`);
console.log(`Слов с ошибкой (нет в эталоне): ${wrongTotal} из ${wrongTotal + rightTotal}`);
console.log(`  из них подсвечено жёлтым: ${wrongFlagged} (${pct(wrongFlagged, wrongTotal)} ошибок поймано)`);
console.log(`  верных слов подсвечено зря: ${rightFlagged} из ${rightTotal} (${pct(rightFlagged, rightTotal)} ложных тревог)`);
console.log(`Числа в тексте модели: ${numbersTotal}, из них не совпали с эталоном: ${numbersWrong} (все числа подчёркнуты)`);
console.log(`Препараты из эталона: ${drugsInRef}; распознаны верно: ${drugsCorrect}; исправила бы подсказка: ${drugsFixable}; осталось потеряно: ${drugsInRef - drugsCorrect - drugsFixable}`);
for (const t of [0.3, 0.5, 0.7, 0.8, 0.9]) {
  const fl = allWordProbs.filter((x) => x.p < t);
  const caught = fl.filter((x) => x.wrong).length;
  console.log(`  порог ${t}: подсвечено ${fl.length} слов, из них ошибок ${caught} (поймано ${pct(caught, wrongTotal)} ошибок; ложных ${pct(fl.length - caught, rightTotal)} верных слов)`);
}
