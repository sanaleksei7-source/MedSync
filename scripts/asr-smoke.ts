// Проверка цепочки «вход → /api/asr → сервис распознавания» без микрофона: отправляет синтетический сигнал.
// Читает вымышленные учётные данные из data/demo-credentials.txt и ничего секретного не печатает.
//   npm run asr:smoke
import { readFileSync } from "node:fs";
import { totpAt } from "../server/auth";

const txt = readFileSync("data/demo-credentials.txt", "utf-8");
const blk = txt.split("\n\n").find((b) => b.startsWith("doctor1 "))!;
const password = /password: (\S+)/.exec(blk)![1];
const secret = /secret \(base32\): (\S+)/.exec(blk)![1];

const base = process.env.API ?? "http://127.0.0.1:8787";
const json = { "Content-Type": "application/json", "X-Requested-With": "medsync" };

const login = await fetch(base + "/api/login", {
  method: "POST",
  headers: json,
  body: JSON.stringify({ username: "doctor1", password, code: totpAt(secret, Date.now()) }),
});
console.log("login:", login.status);
const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";

const pcm = (seconds: number, amp: number) =>
  new Uint8Array(Int16Array.from({ length: Math.round(seconds * 16000) }, (_, i) => Math.round(Math.sin(i / 8) * amp)).buffer);

for (const [name, bytes] of [["tone 2 s", pcm(2, 8000)], ["silence 1.5 s", pcm(1.5, 0)]] as const) {
  const r = await fetch(base + "/api/asr", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream", "X-Requested-With": "medsync", "X-Sample-Rate": "16000", Cookie: cookie },
    body: bytes,
  });
  console.log(`${name}: HTTP ${r.status}`, (await r.text()).slice(0, 200));
}
