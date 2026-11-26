import { applySuggestion, suggestDrug } from "./suggest";

const t: [string, boolean][] = [];

// Ошибки, которые маленькая модель действительно сделала на тестовых записях
t.push(["Амоксицилин → амоксициллин", suggestDrug("Амоксицилин") === "амоксициллин"]);
t.push(["амексицилин → амоксициллин", suggestDrug("амексицилин") === "амоксициллин"]);
t.push(["пеницелин → пенициллин", suggestDrug("пеницелин,") === "пенициллин"]);
t.push(["фурацелина → фурацилин", suggestDrug("фурацелина") === "фурацилин"]);
t.push(["фуроцелина → фурацилин", suggestDrug("фуроцелина") === "фурацилин"]);

// Правильные слова и формы не трогаем
t.push(["correct drug untouched", suggestDrug("амоксициллин") === null && suggestDrug("Фурацилин") === null]);
t.push(["case form untouched", suggestDrug("фурацилина") === null && suggestDrug("аспирином") === null]);

// Обычные слова не принимаем за препараты
const common = ["температура", "аллергия", "пациентки", "гиперемирован", "миллиграммов", "полоскание", "обильное", "давление", "горло", "пульс"];
t.push(["common words are not drugs", common.every((w) => suggestDrug(w) === null)]);

// Замена в тексте
t.push(["apply keeps capital letter and punctuation", applySuggestion("Назначаю Амоксицилин, по 500 мг.", "Амоксицилин,", "амоксициллин") === "Назначаю Амоксициллин, по 500 мг."]);
t.push(["apply lower case", applySuggestion("аллергия на пеницелин.", "пеницелин.", "пенициллин") === "аллергия на пенициллин."]);
t.push(["apply with empty word is a no-op", applySuggestion("текст", ",", "x") === "текст"]);

let n = 0;
for (const [name, ok] of t) if (!ok) { n++; console.error("FAIL", name); }
console.log(n ? `BAD suggest (${n})` : `ok suggest (${t.length})`);
process.exit(n ? 1 : 0);
