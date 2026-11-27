import { useEffect, useState } from "react";
import { api } from "../api";
import { formatPin } from "../data/pin";
import type { PatientView } from "../domain/patient";

const birth = (d: string) => d.split("-").reverse().join(".");

export default function Patients() {
  const [patients, setPatients] = useState<PatientView[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ patients: PatientView[] }>("GET", "/api/patients").then((r) => setPatients(r.patients), (e) => setError(e instanceof Error ? e.message : "Не удалось загрузить пациентов"));
  }, []);
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!patients) return <p className="text-sm text-slate-500">Загрузка…</p>;
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Пациенты</h1>
      {patients.length === 0 && <p className="text-sm text-slate-500">За вами пока никто не закреплён.</p>}

      {/* Телефон: карточки */}
      <ul className="space-y-2 md:hidden">
        {patients.map((p) => (
          <li key={p.id} className="rounded bg-white p-4 shadow-sm">
            <div className="font-medium">{p.name}</div>
            <div className="text-sm text-slate-600">{birth(p.birthDate)}</div>
            <div className="font-mono text-sm text-slate-600">ПИН {formatPin(p.pin)}</div>
            {p.allergies.length > 0 && (
              <div className="mt-1 inline-block rounded bg-red-50 px-2 py-0.5 text-xs text-red-800">
                Аллергия: {p.allergies.join(", ")}
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* Компьютер: таблица */}
      <table className="hidden w-full overflow-hidden rounded bg-white text-left text-sm shadow-sm md:table">
        <thead className="bg-slate-100 text-slate-600">
          <tr>
            <th className="p-3">ФИО</th>
            <th className="p-3">Дата рождения</th>
            <th className="p-3">ПИН</th>
            <th className="p-3">Аллергии</th>
          </tr>
        </thead>
        <tbody>
          {patients.map((p) => (
            <tr key={p.id} className="border-t">
              <td className="p-3">{p.name}</td>
              <td className="p-3">{birth(p.birthDate)}</td>
              <td className="p-3 font-mono">{formatPin(p.pin)}</td>
              <td className="p-3">{p.allergies.join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
