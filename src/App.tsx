import { useEffect, useRef, useState } from "react";
import Home from "./pages/Home";
import Patients from "./pages/Patients";
import Appointment from "./pages/Appointment";
import History from "./pages/History";
import Login from "./pages/Login";
import Account from "./pages/Account";
import AdminUsers from "./pages/AdminUsers";
import { api, ApiError, forgetSession, setSessionLostHandler, type Me } from "./api";
import { CHANNEL, useSessionGuard, type SignOutReason } from "./session/useSessionGuard";
import { clearCopiedText } from "./session/clipboard";

// Почему человек видит страницу входа: после выхода страница перезагружается и объясняет причину (без записи в хранилище браузера).
const outNotice: Record<string, string> = {
  idle: "Вы вышли из системы из-за бездействия. Войдите снова.",
  expired: "Сессия истекла. Войдите снова.",
  other: "Вы вышли из системы в другой вкладке.",
};
const loginNotice = (() => {
  const q = new URLSearchParams(location.search).get("out");
  if (q !== null) history.replaceState(null, "", location.pathname);
  return q && outNotice[q] ? outNotice[q] : "";
})();

const tabs = [
  { id: "home", label: "Главная" },
  { id: "patients", label: "Пациенты" },
  { id: "appointment", label: "Приём" },
  { id: "history", label: "История" },
] as const;
type Tab = (typeof tabs)[number]["id"];

const alertLabel: Record<string, string> = {
  "denied.burst": "Много отказов в доступе",
  "login.fail.burst": "Подбор пароля",
  "token.reuse": "Повторное использование токена",
  "read.burst": "Массовое чтение карт",
  "off.hours": "Работа ночью",
  "breakglass": "Экстренный доступ к карте",
  "account.verify.burst": "Подбор при смене пароля",
  "login.stuffing": "Перебор учётных записей с одного адреса",
  "login.after.failures": "Вход после неудачных попыток",
  "login.new.ip": "Вход с нового адреса",
};

const editLabel: Record<string, string> = { asr: "распознано", add: "добавлено вручную", edit: "исправлено", delete: "удалено", speaker: "сменён говорящий" };
interface Edit { time: string; actor: string; visit: string; line: number; op: string }

/** История правок расшифровки для аудитора: кто, когда, какую реплику и как менял. Текста здесь нет. */
function EditsPanel() {
  const [visit, setVisit] = useState("");
  const [edits, setEdits] = useState<Edit[] | null>(null);
  const [err, setErr] = useState("");
  const load = async (id: string) => {
    setErr("");
    try { setEdits((await api<{ edits: Edit[] }>("GET", id ? `/api/audit/edits/${id}` : "/api/audit/edits")).edits); } catch (e) { setErr(e instanceof Error ? e.message : "Ошибка"); }
  };
  useEffect(() => { void load(""); }, []);
  return (
    <section className="rounded bg-white p-4 text-sm shadow-sm">
      <h2 className="mb-2 font-medium">Правки расшифровки</h2>
      <form onSubmit={(e) => { e.preventDefault(); void load(visit.trim()); }} className="mb-2 flex flex-wrap gap-2">
        <input value={visit} onChange={(e) => setVisit(e.target.value)} placeholder="Номер приёма (пусто — последние)" className="min-w-0 flex-1 rounded border px-3 py-2 font-mono md:max-w-sm" />
        <button className="rounded border px-3 py-2 md:py-1">Показать</button>
      </form>
      {err && <p className="text-red-600">{err}</p>}
      {edits && edits.length === 0 && <p className="text-slate-500">Правок нет.</p>}
      {edits && edits.length > 0 && (
        <ul className="space-y-1">
          {edits.map((x, i) => (
            <li key={i}>
              <span className="text-slate-400">{new Date(x.time).toLocaleString("ru-RU")}</span> · {x.actor} · реплика #{x.line} · <b>{editLabel[x.op] ?? x.op}</b>
              {!visit.trim() && <button type="button" onClick={() => { setVisit(x.visit); void load(x.visit); }} className="ml-1 font-mono text-xs text-teal-700 underline">{x.visit.slice(0, 8)}…</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AuditPanel() {
  const [result, setResult] = useState("");
  const [alerts, setAlerts] = useState<{ time: string; rule: string; key: string; count: number }[] | null>(null);
  useEffect(() => {
    api<{ alerts: { time: string; rule: string; key: string; count: number }[] }>("GET", "/api/audit/alerts").then((r) => setAlerts(r.alerts), () => setAlerts([]));
  }, []);
  const verify = async () => {
    try {
      const r = await api<{ ok: boolean; count?: number; brokenAt?: number; reason?: string }>("GET", "/api/audit/verify");
      setResult(r.ok ? `Журнал цел: ${r.count} записей` : `Журнал нарушен на записи ${r.brokenAt}: ${r.reason}`);
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Ошибка");
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-slate-700">Эта роль не видит медицинских данных.</p>
      <button onClick={verify} className="rounded border px-3 py-1.5 text-sm">Проверить целостность журнала аудита</button>
      {result && <p className="text-sm">{result}</p>}
      <EditsPanel />
      <section className="rounded bg-white p-4 text-sm shadow-sm">
        <h2 className="mb-2 font-medium">Тревоги о необычном доступе</h2>
        {alerts === null ? <p className="text-slate-500">Загрузка…</p> : alerts.length === 0 ? <p className="text-slate-500">Тревог нет.</p> : (
          <ul className="space-y-1">
            {alerts.map((a, i) => (
              <li key={i}><span className="text-slate-400">{new Date(a.time).toLocaleString("ru-RU")}</span> · <b>{alertLabel[a.rule] ?? a.rule}</b> · {a.key}{a.count > 1 ? ` (${a.count})` : ""}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = ещё проверяем
  const [tab, setTab] = useState<Tab>("home");
  const [showAccount, setShowAccount] = useState(false);
  const [resume, setResume] = useState<string | null>(null); // приём из истории, который надо продолжить

  useEffect(() => {
    api<Me>("GET", "/api/me").then(setMe, (e) => {
      if (!(e instanceof ApiError) || e.status !== 401) console.error(e);
      setMe(null);
    });
  }, []);

  const leaving = useRef(false);

  /**
   * Выход очищает всё, что страница держала в памяти: страница перезагружается целиком (состояние экранов, токены, черновики на экране).
   * Остальные вкладки этого браузера выходят вместе с ней.
   */
  const signOut = async (reason?: SignOutReason, serverAlready = false) => {
    if (leaving.current) return;
    leaving.current = true;
    if (!serverAlready) await Promise.race([api("POST", "/api/logout", {}).catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
    forgetSession();
    clearCopiedText();
    if (typeof BroadcastChannel !== "undefined") {
      const c = new BroadcastChannel(CHANNEL);
      c.postMessage({ t: "logout", reason: reason ?? "other" });
      c.close();
    }
    location.replace(reason ? `/?out=${reason}` : "/");
  };

  // Сервер сказал «нужен вход» на любой запрос — сразу выходим, не оставляя на экране старые данные.
  useEffect(() => {
    setSessionLostHandler(() => { void signOut("expired", true); });
    return () => setSessionLostHandler(null);
  }, []);

  // Другая вкладка вышла — выходим и здесь.
  useEffect(() => {
    if (!me || typeof BroadcastChannel === "undefined") return;
    const c = new BroadcastChannel(CHANNEL);
    c.onmessage = (e) => {
      if (e.data?.t !== "logout" || leaving.current) return;
      leaving.current = true;
      forgetSession();
      location.replace(`/?out=${e.data.reason in outNotice ? e.data.reason : "other"}`);
    };
    return () => c.close();
  }, [!!me]);

  const secondsLeft = useSessionGuard(!!me, (r) => { void signOut(r, r === "expired"); });

  const refreshMe = () => api<Me>("GET", "/api/me").then(setMe, () => setMe(null));

  if (me === undefined) return <div className="p-6 text-slate-500">Загрузка…</div>;

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      {secondsLeft !== null && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="idle-title" className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded bg-white p-5 shadow-lg">
            <h2 id="idle-title" className="font-semibold">Вы ещё здесь?</h2>
            <p className="mt-1 text-sm text-slate-600">Из-за бездействия MedSync выйдет из системы через {secondsLeft} с. Всё, что уже сохранено на сервере, останется в черновике.</p>
            <div className="mt-3 flex gap-2">
              <button autoFocus className="rounded bg-teal-600 px-4 py-2 text-sm text-white">Остаться в системе</button>
              <button onClick={() => void signOut()} className="rounded border px-4 py-2 text-sm">Выйти сейчас</button>
            </div>
          </div>
        </div>
      )}
      <header className="safe-top sticky top-0 z-20 flex flex-wrap items-center gap-x-6 gap-y-1 border-b bg-white px-4 py-2 md:px-6 md:py-3">
        <span className="text-lg font-semibold text-teal-700">MedSync</span>
        {me?.role === "doctor" && !me.setup && (
          <nav className="hidden gap-1 md:flex">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setShowAccount(false); }}
                aria-current={tab === t.id && !showAccount ? "page" : undefined}
                className={`rounded px-3 py-1.5 text-sm ${tab === t.id && !showAccount ? "bg-teal-600 text-white" : "hover:bg-slate-100"}`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        )}
        <span className="ml-auto rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Демо · вымышленные данные</span>
        {me && (
          <span className="flex items-center gap-2 text-sm text-slate-600">
            <span className="max-w-[10rem] truncate">{me.name}</span>
            {!me.setup && <button onClick={() => setShowAccount((v) => !v)} className="rounded border px-3 py-1 text-xs">Аккаунт</button>}
            <button onClick={() => void signOut()} className="rounded border px-3 py-1 text-xs">Выйти</button>
          </span>
        )}
      </header>
      <main className={`mx-auto max-w-7xl p-4 md:p-6 ${me?.role === "doctor" && !me.setup ? "pb-24 md:pb-6" : ""}`}>
        {!me && <Login onLogin={setMe} notice={loginNotice} />}
        {me?.setup && <Account me={me} forced onChanged={refreshMe} onRelogin={() => { forgetSession(); setMe(null); }} />}
        {me && !me.setup && showAccount && <Account me={me} forced={false} onChanged={refreshMe} onRelogin={() => { forgetSession(); setMe(null); setShowAccount(false); }} />}
        {me && !me.setup && !showAccount && me.role === "admin" && <AdminUsers selfId={me.id} />}
        {me && !me.setup && !showAccount && me.role === "auditor" && <AuditPanel />}
        {me?.role === "doctor" && !me.setup && !showAccount && (
          <>
            {tab === "home" && <Home onStart={() => setTab("appointment")} />}
            {tab === "patients" && <Patients />}
            {tab === "appointment" && <Appointment resumeId={resume} onResumed={() => setResume(null)} />}
            {tab === "history" && <History onOpen={(id) => { setResume(id); setTab("appointment"); }} />}
          </>
        )}
      </main>
      <footer className={`mx-auto max-w-7xl px-4 text-xs text-slate-500 md:px-6 md:pb-8 ${me?.role === "doctor" && !me.setup ? "pb-28" : "pb-8"}`}>
        Демо-версия. Все пациенты и данные вымышленные. Разговор — заранее написанный сценарий, а не запись и не
        реальное распознавание речи. ЭЦП и отправка в медкарту — имитация без юридической силы. Не является
        медицинским изделием.
      </footer>
      {me?.role === "doctor" && !me.setup && (
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t bg-white md:hidden" aria-label="Разделы">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setShowAccount(false); }}
              aria-current={tab === t.id && !showAccount ? "page" : undefined}
              className={`min-h-14 px-1 text-xs font-medium ${tab === t.id && !showAccount ? "text-teal-700 shadow-[inset_0_2px_0_0_var(--color-teal-600)]" : "text-slate-500"}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
