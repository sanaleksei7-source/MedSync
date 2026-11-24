// Запуск: npm run eval  (нужен ANTHROPIC_API_KEY, тратит реальные деньги: по одному запросу на кейс)
import Anthropic from "@anthropic-ai/sdk";
import { extractDraft } from "../llm";
import { cases } from "./cases";
import { checkCase } from "./check";

const client = new Anthropic();
let failed = 0;
for (const c of cases) {
  try {
    const sections = await extractDraft(client, c.docTitle, c.sectionTitles, c.lines);
    const problems = checkCase(c, sections);
    console.log(problems.length ? `FAIL ${c.name}\n  - ${problems.join("\n  - ")}` : `ok   ${c.name}`);
    if (problems.length) failed++;
  } catch (e) {
    failed++;
    console.log(`ERR  ${c.name}: ${e instanceof Error ? e.message : e}`);
  }
}
console.log(failed ? `${failed} case(s) failed` : "all cases passed");
process.exit(failed ? 1 : 0);
