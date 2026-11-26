import { resetHistory, useHistory } from "../data/history";

const statusLabel = { signed: "Подписан", sent: "Отправлен в медкарту" } as const;
const when = (t: string) => new Date(t).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });

export default function History() {
  const entries = useHistory();
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">История приёмов</h1>
        <button onClick={resetHistory} className="rounded border px-3 py-1 text-sm text-slate-600">Сбросить демо-историю</button>
      </div>
      <p className="mb-2 text-xs text-slate-500">Хранится только в этом браузере.</p>

      {/* Телефон: карточки */}
      <ul className="space-y-2 md:hidden">
        {entries.map((e) => (
          <li key={e.id} className="rounded bg-white p-4 shadow-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{e.patientName}</span>
              <span className="shrink-0 text-xs text-slate-500">{when(e.time)}</span>
            </div>
            <div className="text-sm text-slate-600">{e.docLabel}</div>
            <div className={`mt-1 inline-block rounded px-2 py-0.5 text-xs ${e.status === "sent" ? "bg-green-100 text-green-800" : "bg-teal-50 text-teal-800"}`}>
              {statusLabel[e.status]}
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
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-t">
              <td className="p-3">{when(e.time)}</td>
              <td className="p-3">{e.patientName}</td>
              <td className="p-3">{e.docLabel}</td>
              <td className="p-3">{statusLabel[e.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
