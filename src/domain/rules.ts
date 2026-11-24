// Правила, без которых документ нельзя подписывать. Вынесены из интерфейса в чистые функции,
// чтобы те же проверки позже выполнялись на сервере (Фаза 1) и покрывались тестами.
import type { AllergyConflict } from "../data/allergy";
import type { Section } from "../data/script";

export type Action = "kept" | "removed" | "edited";
export interface Decision { action: Action; text?: string }
export type Decisions = Record<string, Decision>;

export const keyOf = (sectionIndex: number, statementIndex: number) => `${sectionIndex}-${statementIndex}`;

/** Утверждения без источника, по которым врач ещё не принял решение (видимые в документе). */
export function uncheckedKeys(sections: Section[], decisions: Decisions, isVisible: (ids: number[]) => boolean): string[] {
  const out: string[] = [];
  sections.forEach((sec, si) =>
    sec.statements.forEach((st, i) => {
      const k = keyOf(si, i);
      if (isVisible(st.sourceIds) && st.sourceIds.length === 0 && !decisions[k]) out.push(k);
    }),
  );
  return out;
}

/** Конфликты с аллергией, которые касаются оставшихся в документе утверждений и не подтверждены врачом. */
export function blockingConflicts(
  sections: Section[],
  decisions: Decisions,
  conflicts: AllergyConflict[],
  acknowledged: number[],
): AllergyConflict[] {
  const stillCited = (lineId: number) =>
    sections.some((sec, si) =>
      sec.statements.some((st, i) => st.sourceIds.includes(lineId) && decisions[keyOf(si, i)]?.action !== "removed"),
    );
  return conflicts.filter((c) => stillCited(c.lineId) && !acknowledged.includes(c.lineId));
}

export interface SignBlockers {
  unchecked: string[];
  allergy: AllergyConflict[];
}

export function signBlockers(
  sections: Section[],
  decisions: Decisions,
  conflicts: AllergyConflict[],
  acknowledged: number[],
  isVisible: (ids: number[]) => boolean,
): SignBlockers {
  return {
    unchecked: uncheckedKeys(sections, decisions, isVisible),
    allergy: blockingConflicts(sections, decisions, conflicts, acknowledged),
  };
}

export const canSign = (b: SignBlockers) => b.unchecked.length === 0 && b.allergy.length === 0;
