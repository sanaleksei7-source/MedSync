import type { Section } from "../../src/data/script";
import type { EvalCase } from "./cases";

export function checkCase(c: EvalCase, sections: Section[]): string[] {
  const texts = sections.flatMap((s) => s.statements.map((st) => st.text.toLowerCase()));
  const problems: string[] = [];
  for (const bad of c.mustNotContain ?? []) {
    const hit = texts.find((t) => t.includes(bad.toLowerCase()));
    if (hit) problems.push(`forbidden «${bad}» in «${hit}»`);
  }
  for (const need of c.mustContain ?? []) {
    if (!texts.some((t) => t.includes(need.toLowerCase()))) problems.push(`missing «${need}»`);
  }
  return problems;
}
