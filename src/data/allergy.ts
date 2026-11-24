import type { Line } from "./script";

// Демо-справочник: аллерген -> корни названий препаратов той же группы.
// Не медицинский справочник; перед реальным использованием нужна фармакологическая база.
const groups: { allergen: string; stems: string[] }[] = [
  { allergen: "пенициллин", stems: ["пенициллин", "амоксицил", "ампицил", "амоксиклав", "аугментин", "оксацилл"] },
  { allergen: "аспирин", stems: ["аспирин", "ацетилсалицил"] },
];

export interface AllergyConflict {
  lineId: number;
  drug: string;
  allergen: string;
}

export function findConflicts(allergies: string[], lines: Line[]): AllergyConflict[] {
  const out: AllergyConflict[] = [];
  for (const g of groups) {
    if (!allergies.some((a) => a.toLowerCase() === g.allergen)) continue;
    for (const l of lines) {
      if (l.speaker !== "Врач") continue;
      for (const stem of g.stems) {
        const m = l.text.toLowerCase().match(new RegExp(`[а-яё-]*${stem}[а-яё-]*`));
        if (m) out.push({ lineId: l.id, drug: m[0], allergen: g.allergen });
      }
    }
  }
  return out;
}
