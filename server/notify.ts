// Доставка тревог людям (шаг 3.7): общий вебхук (Slack, Mattermost и т. п.) и/или Telegram-бот.
// В сообщении только правило, идентификатор и число — никаких ФИО, ПИН и медицинского текста.
import type { Alert } from "./alerts";

export type Notifier = (a: Alert) => Promise<void>;

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Текст тревоги. key — идентификатор пользователя, метка адреса или пара «врач>пациент» (номера, не имена). */
export const alertText = (a: Alert, site: string) => `MedSync${site ? ` (${site})` : ""}: тревога «${a.rule}» — ${a.key}${a.count > 1 ? `, ${a.count} раз` : ""}. ${a.message}`;

async function postJson(url: string, body: unknown, timeoutMs: number) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
}

/** Тревоги уходят только по https (кроме локального адреса для проверки). */
export function checkUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && LOCAL.has(u.hostname))) throw new Error("Адрес для тревог должен быть https");
  return u;
}

export function webhookNotifier(url: string, site = "", timeoutMs = 5000): Notifier {
  const u = checkUrl(url).toString();
  return (a) => postJson(u, { text: alertText(a, site) }, timeoutMs);
}

export function telegramNotifier(token: string, chatId: string, site = "", base = "https://api.telegram.org", timeoutMs = 5000): Notifier {
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error("Неверный формат ALERT_TELEGRAM_BOT_TOKEN");
  if (!/^-?\d+$/.test(chatId)) throw new Error("Неверный формат ALERT_TELEGRAM_CHAT_ID");
  const u = checkUrl(`${base}/bot${token}/sendMessage`).toString();
  return (a) => postJson(u, { chat_id: chatId, text: alertText(a, site), disable_web_page_preview: true }, timeoutMs);
}

/** Собирает доставщиков из переменных окружения. Сбой доставки не роняет сервер: тревога в любом случае уже в журнале. */
export function notifierFromEnv(env: NodeJS.ProcessEnv): ((a: Alert) => void) | undefined {
  const site = env.PUBLIC_ORIGIN ? new URL(env.PUBLIC_ORIGIN).host : "";
  const list: Notifier[] = [];
  if (env.ALERT_WEBHOOK_URL) list.push(webhookNotifier(env.ALERT_WEBHOOK_URL, site));
  if (env.ALERT_TELEGRAM_BOT_TOKEN || env.ALERT_TELEGRAM_CHAT_ID) list.push(telegramNotifier(env.ALERT_TELEGRAM_BOT_TOKEN ?? "", env.ALERT_TELEGRAM_CHAT_ID ?? "", site));
  if (list.length === 0) return undefined;
  return (a) => { for (const n of list) n(a).catch((e) => console.error(`Тревогу «${a.rule}» не удалось отправить:`, e instanceof Error ? e.message : e)); };
}
