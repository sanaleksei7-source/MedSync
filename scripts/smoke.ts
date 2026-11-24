// Дымовой тест работающего сервера (npm run server). Читает вымышленные учётные данные из
// data/demo-credentials.txt (создаётся `npm run seed`) и ничего секретного не печатает.
import { readFileSync } from "node:fs";
import { totpAt } from "../server/auth";

const txt = readFileSync("data/demo-credentials.txt", "utf-8");
const cred = (u: string) => {
  const blk = txt.split("\n\n").find((b) => b.startsWith(u + " "))!;
  return { password: /password: (\S+)/.exec(blk)![1], secret: /secret \(base32\): (\S+)/.exec(blk)![1] };
};
const base = "http://127.0.0.1:8787";
const h = { "Content-Type": "application/json", "X-Requested-With": "medsync" };
const out: string[] = [];

const login = async (u: string) => {
  const c = cred(u);
  const r = await fetch(base + "/api/login", {
    method: "POST",
    headers: h,
    body: JSON.stringify({ username: u, password: c.password, code: totpAt(c.secret, Date.now()) }),
  });
  return { status: r.status, cookie: r.headers.get("set-cookie")?.split(";")[0] ?? "" };
};

const doctor = await login("doctor1");
out.push(`doctor1 login: ${doctor.status}`);

const lines = [
  { id: 1, speaker: "Пациент", text: "Болит горло." },
  { id: 2, speaker: "Врач", text: "Добавим амоксициллин." },
];
const sections = [
  { title: "Жалобы", statements: [{ text: "Боль в горле.", sourceIds: [1] }] },
  { title: "Назначения", statements: [{ text: "Амоксициллин", sourceIds: [2] }] },
];
const sign = async (cookie: string, patientId: string, decisions: object, ack: number[]) =>
  (await fetch(base + "/api/sign", {
    method: "POST",
    headers: { ...h, Cookie: cookie },
    body: JSON.stringify({ patientId, docType: "Осмотр", lines, sections, decisions, ackAllergy: ack }),
  })).status;

out.push(`sign with allergy conflict (expect 409): ${await sign(doctor.cookie, "p1", {}, [])}`);
out.push(`sign another doctor's patient (expect 403): ${await sign(doctor.cookie, "p3", {}, [])}`);
out.push(`sign after removing the order (expect 200): ${await sign(doctor.cookie, "p1", { "1-0": { action: "removed" } }, [])}`);

const ex = await fetch(base + "/api/extract", {
  method: "POST",
  headers: { ...h, Cookie: doctor.cookie },
  body: JSON.stringify({ docTitle: "Справка", sectionTitles: ["Жалобы"], lines }),
});
out.push(`extract: ${ex.status} ${(await ex.text()).slice(0, 80)}`);

const auditor = await login("auditor1");
const v = await fetch(base + "/api/audit/verify", { headers: { Cookie: auditor.cookie } });
out.push(`auditor verifies audit log: ${v.status} ${await v.text()}`);
console.log(out.join("\n"));
