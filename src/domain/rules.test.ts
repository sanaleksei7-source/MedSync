import { blockingConflicts, canSign, signBlockers, uncheckedKeys } from "./rules";
import type { Section } from "../data/script";

const sections: Section[] = [
  { title: "A", statements: [{ text: "ok", sourceIds: [1] }, { text: "invented", sourceIds: [] }] },
  { title: "B", statements: [{ text: "Амоксициллин", sourceIds: [3] }] },
];
const all = () => true;
const conflict = { lineId: 3, drug: "амоксициллин", allergen: "пенициллин" };
const t: [string, boolean][] = [];

t.push(["unsourced fact blocks", uncheckedKeys(sections, {}, all).join() === "0-1"]);
t.push(["kept fact unblocks", uncheckedKeys(sections, { "0-1": { action: "kept" } }, all).length === 0]);
t.push(["removed fact unblocks", uncheckedKeys(sections, { "0-1": { action: "removed" } }, all).length === 0]);
t.push(["edited fact unblocks", uncheckedKeys(sections, { "0-1": { action: "edited", text: "x" } }, all).length === 0]);
t.push(["not yet visible not counted", uncheckedKeys(sections, {}, (ids) => ids.length > 0).length === 0]);
t.push(["allergy blocks", blockingConflicts(sections, {}, [conflict], []).length === 1]);
t.push(["ack unblocks", blockingConflicts(sections, {}, [conflict], [3]).length === 0]);
t.push(["removing the order unblocks", blockingConflicts(sections, { "1-0": { action: "removed" } }, [conflict], []).length === 0]);
t.push(["can't sign with both open", !canSign(signBlockers(sections, {}, [conflict], [], all))]);
t.push([
  "can sign when resolved",
  canSign(signBlockers(sections, { "0-1": { action: "kept" } }, [conflict], [3], all)),
]);

let bad = 0;
for (const [n, ok] of t) if (!ok) { bad++; console.error("FAIL", n); }
console.log(bad ? `BAD rules (${bad})` : `ok rules (${t.length})`);
if (bad) process.exit(1);
