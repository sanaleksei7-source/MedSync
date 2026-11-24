import { useState } from "react";
import Home from "./pages/Home";
import Patients from "./pages/Patients";
import Appointment from "./pages/Appointment";
import History from "./pages/History";

const tabs = [
  { id: "home", label: "Главная" },
  { id: "patients", label: "Пациенты" },
  { id: "appointment", label: "Приём" },
  { id: "history", label: "История" },
] as const;
type Tab = (typeof tabs)[number]["id"];

export default function App() {
  const [tab, setTab] = useState<Tab>("home");
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="flex items-center gap-6 border-b bg-white px-6 py-3">
        <span className="text-lg font-semibold text-teal-700">MedSync</span>
        <nav className="flex gap-1">
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
        <span className="ml-auto rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Демо · вымышленные данные</span>
      </header>
      <main className="mx-auto max-w-5xl p-6">
        {tab === "home" && <Home onStart={() => setTab("appointment")} />}
        {tab === "patients" && <Patients />}
        {tab === "appointment" && <Appointment />}
        {tab === "history" && <History />}
      </main>
      <footer className="mx-auto max-w-5xl px-6 pb-8 text-xs text-slate-500">
        Демо-версия. Все пациенты и данные вымышленные. Разговор — заранее написанный сценарий, а не запись и не
        реальное распознавание речи. ЭЦП и отправка в медкарту — имитация без юридической силы. Не является
        медицинским изделием.
      </footer>
    </div>
  );
}
