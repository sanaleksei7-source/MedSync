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

// Демо-приём: разговор и черновик документа берёт сам сервер. Клиент присылает только команды.
const post = async (cookie: string, path: string, body: unknown = {}) => {
  const r = await fetch(base + path, { method: "POST", headers: { ...h, Cookie: cookie }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
};
const visit = await post(doctor.cookie, "/api/visits", { patientId: "p1", docType: "osmotr", demo: true });
out.push(`create demo visit (expect 200): ${visit.status}`);
out.push(`create visit for another doctor's patient (expect 403): ${(await post(doctor.cookie, "/api/visits", { patientId: "p3", docType: "osmotr" })).status}`);
const id = visit.body?.id;
out.push(`sign with unsourced fact and allergy conflict (expect 409): ${(await post(doctor.cookie, `/api/visits/${id}/sign`)).status}`);
// Решаем: оставляем непроверенный факт «Диагноз», убираем назначение амоксициллина (аллергия на пенициллин).
const secs = visit.body.sections as { title: string; statements: { sourceIds: number[] }[] }[];
const unsourced = secs.flatMap((s, si) => s.statements.map((st, i) => ({ st, key: `${si}-${i}` }))).filter((x) => x.st.sourceIds.length === 0);
const orders = secs.findIndex((s) => s.title === "Назначения");
const changes = [
  ...unsourced.map((x) => ({ key: x.key, action: "kept" })),
  ...secs[orders].statements.map((_, i) => ({ key: `${orders}-${i}`, action: "removed" })).slice(1, 2),
];
out.push(`record the doctor's decisions (expect 200): ${(await post(doctor.cookie, `/api/visits/${id}/decisions`, { changes })).status}`);
out.push(`sign after the decisions (expect 200 or 409 if more is left): ${(await post(doctor.cookie, `/api/visits/${id}/sign`)).status}`);
out.push(`another doctor reads this visit (expect 404): ${await (async () => {
  const d2 = await login("doctor2");
  return (await fetch(base + `/api/visits/${id}`, { headers: { Cookie: d2.cookie } })).status;
})()}`);

const auditor = await login("auditor1");
const v = await fetch(base + "/api/audit/verify", { headers: { Cookie: auditor.cookie } });
out.push(`auditor verifies audit log: ${v.status} ${await v.text()}`);
console.log(out.join("\n"));
