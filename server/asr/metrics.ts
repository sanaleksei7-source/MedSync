// Метрики качества распознавания для медицинских разговоров. Чистые функции без сети и аудио.

export const normalize = (s: string): string =>
  s.toLowerCase().replace(/ё/g, "е").replace(/(\d),(\d)/g, "$1.$2").replace(/[^\p{L}\p{N}.\s]/gu, " ").replace(/\.(?!\d)/g, " ").replace(/\s+/g, " ").trim();

const words = (s: string) => (normalize(s) ? normalize(s).split(" ") : []);

function editDistance<T>(a: T[], b: T[]): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** Доля ошибок на слово: (замены + вставки + пропуски) / слов в эталоне. */
export function wer(ref: string, hyp: string): number {
  const r = words(ref);
  const h = words(hyp);
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  return editDistance(r, h) / r.length;
}

export function cer(ref: string, hyp: string): number {
  const r = [...normalize(ref).replace(/ /g, "")];
  const h = [...normalize(hyp).replace(/ /g, "")];
  if (r.length === 0) return h.length === 0 ? 0 : 1;
  return editDistance(r, h) / r.length;
}

/** Названия препаратов из эталона, найденные в тексте распознавания (по основе слова). */
export function termRecall(ref: string, hyp: string, lexicon: string[]): { found: number; total: number; missed: string[] } {
  const rw = words(ref);
  const hw = words(hyp);
  const present = (ws: string[], stem: string) => ws.some((w) => w.startsWith(stem));
  const stems = lexicon.map((t) => normalize(t).slice(0, Math.max(6, Math.min(8, normalize(t).length))));
  const inRef = stems.filter((s) => present(rw, s));
  const missed = inRef.filter((s) => !present(hw, s));
  return { found: inRef.length - missed.length, total: inRef.length, missed };
}

const numbersIn = (s: string): string[] =>
  (s.toLowerCase().replace(/(\d),(\d)/g, "$1.$2").match(/\d+(?:\.\d+)?/g) ?? []);

/** Числа (дозы, температура, пульс) из эталона, которые точно присутствуют в распознанном тексте. */
export function numberRecall(ref: string, hyp: string): { found: number; total: number; missed: string[] } {
  const rem = numbersIn(hyp);
  const missed: string[] = [];
  let found = 0;
  for (const n of numbersIn(ref)) {
    const i = rem.indexOf(n);
    if (i >= 0) { rem.splice(i, 1); found++; } else missed.push(n);
  }
  return { found, total: found + missed.length, missed };
}

const NEGATIONS = new Set(["не", "нет", "без", "ни", "нельзя", "отрицает"]);

/** Потерянное или добавленное «не/нет» меняет смысл («аллергии нет» ↔ «аллергия»). Считаем расхождение. */
export function negationDiff(ref: string, hyp: string): { ref: number; hyp: number; diff: number } {
  const c = (s: string) => words(s).filter((w) => NEGATIONS.has(w)).length;
  const r = c(ref);
  const h = c(hyp);
  return { ref: r, hyp: h, diff: Math.abs(r - h) };
}

/** Слов, выданных на записи без речи, в пересчёте на минуту тишины. */
export function hallucinationPerMinute(textOnSilence: string, silenceSeconds: number): number {
  return silenceSeconds > 0 ? (words(textOnSilence).length / silenceSeconds) * 60 : 0;
}
