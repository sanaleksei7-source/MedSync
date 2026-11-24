import { sanitize } from "./extract";

const lines = [
  { id: 1, speaker: "Врач" as const, text: "x" },
  { id: 2, speaker: "Пациент" as const, text: "y" },
];
const out = sanitize(
  {
    sections: [
      { title: "Жалобы", statements: [{ text: " Боль. ", sourceIds: [2, 2, 99] }, { text: "   ", sourceIds: [1] }] },
      { title: "Левый раздел", statements: [{ text: "a", sourceIds: [1] }] },
      { title: "Диагноз", statements: [{ text: "ОРВИ", sourceIds: [] }] },
    ],
  },
  lines,
  ["Жалобы", "Диагноз", "Назначения"],
);
const ok =
  out.length === 2 &&
  out[0].statements.length === 1 &&
  out[0].statements[0].text === "Боль." &&
  JSON.stringify(out[0].statements[0].sourceIds) === "[2]" &&
  out[1].statements[0].sourceIds.length === 0;
console.log(ok ? "ok sanitize" : "BAD sanitize", JSON.stringify(out));
if (!ok) process.exit(1);
