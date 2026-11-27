import { useEffect, useState } from "react";
import Home from "./pages/Home";
import Patients from "./pages/Patients";
import Appointment from "./pages/Appointment";
import History from "./pages/History";
import Login from "./pages/Login";
import { api, ApiError, type Me } from "./api";

const tabs = [
  { id: "home", label: "Главная" },
  { id: "patients", label: "Пациенты" },
  { id: "appointment", label: "Приём" },
  { id: "history", label: "История" },
] as const;
type Tab = (typeof tabs)[number]["id"];

function AuditPanel() {
  const [result, setResult] = useState("");
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
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined); // undefined = ещё проверяем
  const [tab, setTab] = useState<Tab>("home");
  const [resume, setResume] = useState<string | null>(null); // приём из истории, который надо продолжить

  useEffect(() => {
    api<Me>("GET", "/api/me").then(setMe, (e) => {
      if (!(e instanceof ApiError) || e.status !== 401) console.error(e);
      setMe(null);
    });
  }, []);

  const logout = async () => {
    try { await api("POST", "/api/logout", {}); } finally { setMe(null); setTab("home"); setResume(null); }
  };

  if (me === undefined) return <div className="p-6 text-slate-500">Загрузка…</div>;

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900">
      <header className="safe-top sticky top-0 z-20 flex flex-wrap items-center gap-x-6 gap-y-1 border-b bg-white px-4 py-2 md:px-6 md:py-3">
        <span className="text-lg font-semibold text-teal-700">MedSync</span>
        {me?.role === "doctor" && (
          <nav className="hidden gap-1 md:flex">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded px-3 py-1.5 text-sm ${tab === t.id ? "bg-teal-600 text-white" : "hover:bg-slate-100"}`}
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
            <button onClick={logout} className="rounded border px-3 py-1 text-xs">Выйти</button>
          </span>
        )}
      </header>
      <main className={`mx-auto max-w-5xl p-4 md:p-6 ${me?.role === "doctor" ? "pb-24 md:pb-6" : ""}`}>
        {!me && <Login onLogin={setMe} />}
        {me && me.role !== "doctor" && <AuditPanel />}
        {me?.role === "doctor" && (
          <>
            {tab === "home" && <Home onStart={() => setTab("appointment")} />}
            {tab === "patients" && <Patients />}
            {tab === "appointment" && <Appointment resumeId={resume} onResumed={() => setResume(null)} />}
            {tab === "history" && <History onOpen={(id) => { setResume(id); setTab("appointment"); }} />}
          </>
        )}
      </main>
      <footer className={`mx-auto max-w-5xl px-4 text-xs text-slate-500 md:px-6 md:pb-8 ${me?.role === "doctor" ? "pb-28" : "pb-8"}`}>
        Демо-версия. Все пациенты и данные вымышленные. Разговор — заранее написанный сценарий, а не запись и не
        реальное распознавание речи. ЭЦП и отправка в медкарту — имитация без юридической силы. Не является
        медицинским изделием.
      </footer>
      {me?.role === "doctor" && (
        <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t bg-white md:hidden" aria-label="Разделы">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={`min-h-14 px-1 text-xs font-medium ${tab === t.id ? "text-teal-700 shadow-[inset_0_2px_0_0_var(--color-teal-600)]" : "text-slate-500"}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
