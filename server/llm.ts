import Anthropic from "@anthropic-ai/sdk";
import { OUTPUT_SCHEMA, SYSTEM_PROMPT, buildUserPrompt, sanitize } from "./extract";
import type { Line, Section } from "../src/data/script";

export const MODEL = "claude-opus-5-5";

export class ModelRefusal extends Error {}
export class ModelTruncated extends Error {}

export async function extractDraft(
  client: Anthropic,
  docTitle: string,
  sectionTitles: string[],
  lines: Line[],
): Promise<Section[]> {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(docTitle, sectionTitles, lines) }],
  } as Anthropic.Beta.MessageCreateParamsNonStreaming);

  if (response.stop_reason === "refusal") throw new ModelRefusal();
  if (response.stop_reason === "max_tokens") throw new ModelTruncated();
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("Пустой ответ модели");
  return sanitize(JSON.parse(text.text), lines, sectionTitles);
}
