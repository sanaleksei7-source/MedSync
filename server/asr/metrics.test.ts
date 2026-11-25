import { cer, hallucinationPerMinute, negationDiff, normalize, numberRecall, termRecall, wer } from "./metrics";

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const t: [string, boolean][] = [];

t.push(["normalize keeps decimals", normalize("Температура 37,8, ЧСС 88.") === "температура 37.8 чсс 88"]);
t.push(["normalize е/ё", normalize("всё") === "все"]);
t.push(["wer identical is 0", wer("Горло болит", "горло болит!") === 0]);
t.push(["wer one substitution in four", near(wer("боль в горле третий", "боль в горле второй"), 0.25)]);
t.push(["wer deletion", near(wer("раз два три четыре", "раз два три"), 0.25)]);
t.push(["wer insertion counts", near(wer("раз два", "раз два три"), 0.5)]);
t.push(["wer empty ref, empty hyp", wer("", "") === 0]);
t.push(["wer empty ref, junk hyp", wer("", "что-то") === 1]);
t.push(["cer small slip", cer("амоксициллин", "амоксицилин") < 0.1]);

const lex = ["амоксициллин", "фурацилин", "парацетамол"];
const tr = termRecall("Назначаю амоксициллин и фурацилин", "назначаю амоксицилин и фурацилина", lex);
t.push(["term recall: both found by stem", tr.total === 2 && tr.found === 2]);
const tr2 = termRecall("Назначаю амоксициллин и фурацилин", "назначаю амок сицилин и фурацилин", lex);
t.push(["term recall: split drug name is missed", tr2.total === 2 && tr2.found === 1 && tr2.missed.length === 1]);
t.push(["term recall: terms not in reference are ignored", termRecall("Горло болит", "горло болит", lex).total === 0]);

const nr = numberRecall("Температура 37,8, пульс 88, доза 500", "температура 37,8 пульс 80 доза 500");
t.push(["number recall catches 88→80", nr.total === 3 && nr.found === 2 && nr.missed.join() === "88"]);
t.push(["number recall: comma and dot equal", numberRecall("37,8", "37.8").found === 1]);
t.push(["number recall: duplicates counted", numberRecall("5 и 5", "5").found === 1 && numberRecall("5 и 5", "5").total === 2]);

const nd = negationDiff("аллергии нет, температуру не мерили", "аллергия температуру не мерили");
t.push(["negation lost is detected", nd.ref === 2 && nd.hyp === 1 && nd.diff === 1]);
t.push(["negation equal", negationDiff("нет жалоб", "нет жалоб").diff === 0]);

t.push(["hallucination per minute", near(hallucinationPerMinute("спасибо за просмотр", 30), 6)]);
t.push(["no silence → 0", hallucinationPerMinute("текст", 0) === 0]);

let n = 0;
for (const [name, ok] of t) if (!ok) { n++; console.error("FAIL", name); }
console.log(n ? `BAD asr-metrics (${n})` : `ok asr-metrics (${t.length})`);
process.exit(n ? 1 : 0);
