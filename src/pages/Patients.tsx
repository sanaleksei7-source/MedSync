import { patients } from "../data/patients";
import { formatPin } from "../data/pin";

export default function Patients() {
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Пациенты</h1>
      <table className="w-full overflow-hidden rounded bg-white text-left text-sm shadow-sm">
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
              <td className="p-3">{p.birthDate.split("-").reverse().join(".")}</td>
              <td className="p-3 font-mono">{formatPin(p.pin)}</td>
              <td className="p-3">{p.allergies.join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
