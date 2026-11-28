// Тесты доставки тревог: формат сообщения, только https, сбой доставки не роняет сервер.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { alertText, checkUrl, notifierFromEnv, telegramNotifier, webhookNotifier } from "./notify";

const t: [string, boolean][] = [];
const check = (n: string, ok: boolean) => t.push([n, ok]);
const got: { url: string; body: unknown }[] = [];
let failNext = false;
const srv = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => { got.push({ url: req.url ?? "", body: JSON.parse(b) }); res.writeHead(failNext ? 500 : 200).end("{}"); });
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
const a = { rule: "breakglass", key: "u-doc1>p4", count: 1, message: "Экстренный доступ к карте пациента" };

check("message carries rule, ids and site, nothing else", alertText(a, "medsync.example.kg") === "MedSync (medsync.example.kg): тревога «breakglass» — u-doc1>p4. Экстренный доступ к карте пациента" && alertText({ ...a, count: 7 }, "").includes("7 раз"));
check("plain http to a remote address is refused", (() => { try { checkUrl("http://hooks.example/x"); return false; } catch { return true; } })() && checkUrl("https://hooks.example/x").protocol === "https:");
await webhookNotifier(`${base}/hook`)(a);
check("webhook gets {text}", got.at(-1)?.url === "/hook" && typeof (got.at(-1)?.body as { text?: string }).text === "string");
await telegramNotifier("123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ", "-100200", "", base)(a);
check("telegram gets chat_id and text at /bot<token>/sendMessage", got.at(-1)?.url === "/bot123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ/sendMessage" && (got.at(-1)?.body as { chat_id?: string }).chat_id === "-100200");
check("bad telegram settings are refused at start", (() => { try { telegramNotifier("nope", "1"); return false; } catch { return true; } })() && (() => { try { telegramNotifier("123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abc"); return false; } catch { return true; } })());
check("no settings → no notifier", notifierFromEnv({}) === undefined);
failNext = true;
const errors: unknown[] = [];
const orig = console.error;
console.error = (...x: unknown[]) => { errors.push(x); };
notifierFromEnv({ ALERT_WEBHOOK_URL: `${base}/hook` })!(a);
await new Promise((r) => setTimeout(r, 300));
console.error = orig;
check("a failed delivery is reported on the console and does not throw", errors.length === 1);
srv.close();

let bad = 0;
for (const [n, ok] of t) if (!ok) { bad++; console.error("FAIL", n); }
console.log(bad ? `BAD notify (${bad}/${t.length})` : `ok notify (${t.length})`);
process.exit(bad ? 1 : 0);
