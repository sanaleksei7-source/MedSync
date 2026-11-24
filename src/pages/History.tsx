import { resetHistory, useHistory } from "../data/history";

const statusLabel = { signed: "Подписан", sent: "Отправлен в медкарту" } as const;

export default function History() {
  const entries = useHistory();
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">История приёмов</h1>
        <button onClick={resetHistory} className="rounded border px-3 py-1 text-sm text-slate-600">Сбросить демо-историю</button>
      </div>
      <p className="mb-2 text-xs text-slate-500">Хранится только в этом браузере.</p>
      <table className="w-full overflow-hidden rounded bg-white text-left text-sm shadow-sm">
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
              <td className="p-3">{new Date(e.time).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })}</td>
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
