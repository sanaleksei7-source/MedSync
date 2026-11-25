// Проверка качества распознавания на размеченных записях.
//   npm run asr:eval -- <папка>      (нужен ASR_URL, см. docs/ASR_DESIGN.md)
// В папке: name.wav + name.txt (эталон) для речи и silence-*.wav (без текста) для проверки «галлюцинаций».
// WAV: PCM 16 бит, моно, 16000 Гц. Только вымышленные записи: реальных пациентов сюда не класть.
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HttpWhisperEngine, SAMPLE_RATE, isHallucination, wavToPcm } from "../server/asr/engine";
import { DRUG_LEXICON } from "../server/asr/lexicon";
import { cer, hallucinationPerMinute, negationDiff, numberRecall, termRecall, wer } from "../server/asr/metrics";

const dir = process.argv[2];
if (!dir || !process.env.ASR_URL) {
  console.error("Использование: ASR_URL=http://127.0.0.1:8080 npm run asr:eval -- <папка с wav и txt>");
  process.exit(1);
}
const engine = new HttpWhisperEngine(process.env.ASR_URL, process.env.ASR_ALLOW_REMOTE === "1");
const CHUNK = 25 * SAMPLE_RATE;

async function transcribeFile(path: string) {
  const pcm = wavToPcm(readFileSync(path));
  const started = Date.now();
  const parts: string[] = [];
  for (let i = 0; i < pcm.length; i += CHUNK) parts.push(await engine.transcribe(pcm.subarray(i, i + CHUNK)));
  const seconds = pcm.length / SAMPLE_RATE;
  return { text: parts.join(" "), seconds, rtf: (Date.now() - started) / 1000 / seconds };
}

const files = readdirSync(dir).filter((f) => f.endsWith(".wav")).sort();
const rows: Record<string, number | string>[] = [];
const sum = { wer: 0, cer: 0, termF: 0, termT: 0, numF: 0, numT: 0, neg: 0, secs: 0, rtf: 0, n: 0 };
let silenceWords = 0, silenceSecs = 0, silenceDropped = 0;

for (const f of files) {
  const wav = join(dir, f);
  if (f.startsWith("silence")) {
    const r = await transcribeFile(wav);
    if (isHallucination(r.text)) silenceDropped++;
    silenceWords += r.text.trim() ? r.text.trim().split(/\s+/).length : 0;
    silenceSecs += r.seconds;
    continue;
  }
  const refPath = wav.replace(/\.wav$/, ".txt");
  if (!existsSync(refPath)) { console.warn(`нет эталона для ${f}, пропущен`); continue; }
  const ref = readFileSync(refPath, "utf-8");
  const r = await transcribeFile(wav);
  const tr = termRecall(ref, r.text, DRUG_LEXICON);
  const nr = numberRecall(ref, r.text);
  const ng = negationDiff(ref, r.text);
  rows.push({ file: f, WER: +wer(ref, r.text).toFixed(3), CER: +cer(ref, r.text).toFixed(3), "drugs": `${tr.found}/${tr.total}`, "numbers": `${nr.found}/${nr.total}`, "neg diff": ng.diff, RTF: +r.rtf.toFixed(2) });
  if (tr.missed.length) console.log(`  ${f}: пропущены препараты: ${tr.missed.join(", ")}`);
  if (nr.missed.length) console.log(`  ${f}: потеряны числа: ${nr.missed.join(", ")}`);
  sum.wer += wer(ref, r.text); sum.cer += cer(ref, r.text);
  sum.termF += tr.found; sum.termT += tr.total; sum.numF += nr.found; sum.numT += nr.total;
  sum.neg += ng.diff; sum.secs += r.seconds; sum.rtf += r.rtf; sum.n++;
}

console.table(rows);
const summary = {
  files: sum.n,
  audioMinutes: +(sum.secs / 60).toFixed(1),
  meanWER: sum.n ? +(sum.wer / sum.n).toFixed(3) : null,
  meanCER: sum.n ? +(sum.cer / sum.n).toFixed(3) : null,
  drugRecall: sum.termT ? +(sum.termF / sum.termT).toFixed(3) : null,
  numberRecall: sum.numT ? +(sum.numF / sum.numT).toFixed(3) : null,
  negationErrors: sum.neg,
  meanRealTimeFactor: sum.n ? +(sum.rtf / sum.n).toFixed(2) : null,
  silenceWordsPerMinute: silenceSecs ? +hallucinationPerMinute("x ".repeat(silenceWords), silenceSecs).toFixed(2) : null,
  silenceFilesFlaggedAsHallucination: silenceDropped,
};
console.log(summary);
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify({ summary, rows }, null, 2));
