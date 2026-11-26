// Подсказки названий препаратов: если распознанное слово очень похоже на препарат из списка, врачу
// предлагается замена. Ничего не заменяется само: решает врач одним нажатием.
import { DRUG_LEXICON } from "../data/drugs";

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}]/gu, "");

function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** Возвращает препарат из списка, на который похоже слово, или null. Правильно написанные слова не трогает. */
export function suggestDrug(word: string, lexicon: string[] = DRUG_LEXICON): string | null {
  const w = norm(word);
  if (w.length < 6) return null;
  let best: string | null = null;
  let bestDist = Infinity;
  for (const drug of lexicon) {
    const n = norm(drug);
    if (w === n || (w.startsWith(n) && w.length - n.length <= 3)) {
      // слово совпадает с препаратом или это его падежная форма («фурацилина», «аспирином»)
      if (w === n || lev(w.slice(0, n.length), n) === 0) return null;
    }
    // слово может быть падежной формой: сравниваем и целиком, и по началу такой же длины
    const dist = Math.min(lev(w, n), lev(w.slice(0, n.length), n));
    const limit = n.length >= 8 ? 2 : 1;
    if (dist <= limit && dist < bestDist) {
      best = drug;
      bestDist = dist;
    }
  }
  return best;
}

/** Заменяет слово на препарат, сохраняя заглавную букву и знаки препинания вокруг. */
export function applySuggestion(text: string, word: string, drug: string): string {
  const core = word.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "");
  if (!core) return text;
  const replacement = core[0] === core[0].toUpperCase() && core[0] !== core[0].toLowerCase() ? drug[0].toUpperCase() + drug.slice(1) : drug;
  return text.replace(core, replacement);
}
