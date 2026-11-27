import { useEffect, useState } from "react";
import { api } from "../api";
import { docs, type DocType } from "../data/script";
import type { VisitSummary } from "../domain/patient";

const statusLabel = (e: VisitSummary) => (e.status === "signed" ? "Подписан" : e.hasDraft ? "Черновик" : "Разговор без документа");
const docLabel = (t: string) => (t in docs ? docs[t as DocType].label : t);
const when = (t: string) => new Date(t).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });

export default function History({ onOpen }: { onOpen: (id: string) => void }) {
  const [entries, setEntries] = useState<VisitSummary[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ visits: VisitSummary[] }>("GET", "/api/visits").then((r) => setEntries(r.visits), (e) => setError(e instanceof Error ? e.message : "Не удалось загрузить историю"));
  }, []);
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!entries) return <p className="text-sm text-slate-500">Загрузка…</p>;

  // Продолжить можно только неподписанный приём, у которого уже есть черновик документа.
  const open = (e: VisitSummary) =>
    e.status === "draft" && e.hasDraft ? (
      <button onClick={() => onOpen(e.id)} className="rounded border px-3 py-1.5 text-sm text-teal-700 md:px-2 md:py-0.5">Продолжить</button>
    ) : null;

  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold">История приёмов</h1>
      <p className="mb-2 text-xs text-slate-500">Хранится на сервере в зашифрованном виде. Здесь только ваши приёмы.</p>
      {entries.length === 0 && <p className="text-sm text-slate-500">Приёмов пока нет.</p>}

      {/* Телефон: карточки */}
      <ul className="space-y-2 md:hidden">
        {entries.map((e) => (
          <li key={e.id} className="rounded bg-white p-4 shadow-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{e.patientName}</span>
              <span className="shrink-0 text-xs text-slate-500">{when(e.signedAt ?? e.updatedAt)}</span>
            </div>
            <div className="text-sm text-slate-600">{docLabel(e.docType)}</div>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className={`inline-block rounded px-2 py-0.5 text-xs ${e.status === "signed" ? "bg-teal-50 text-teal-800" : "bg-amber-50 text-amber-800"}`}>{statusLabel(e)}</span>
              {open(e)}
            </div>
          </li>
        ))}
      </ul>

      {/* Компьютер: таблица */}
      <table className="hidden w-full overflow-hidden rounded bg-white text-left text-sm shadow-sm md:table">
        <thead className="bg-slate-100 text-slate-600">
          <tr>
            <th className="p-3">Дата и время</th>
            <th className="p-3">Пациент</th>
            <th className="p-3">Документ</th>
            <th className="p-3">Статус</th>
            <th className="p-3"></th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t">
              <td className="p-3">{when(e.signedAt ?? e.updatedAt)}</td>
              <td className="p-3">{e.patientName}</td>
              <td className="p-3">{docLabel(e.docType)}</td>
              <td className="p-3">{statusLabel(e)}</td>
              <td className="p-3 text-right">{open(e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
