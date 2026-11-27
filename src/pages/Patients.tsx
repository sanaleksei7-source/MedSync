import { useEffect, useState } from "react";
import { api } from "../api";
import { formatPin } from "../data/pin";
import type { PatientView } from "../domain/patient";

const birth = (d: string) => d.split("-").reverse().join(".");

interface Grant { patientId: string; name: string; expiresAt: string }

/** Экстренный доступ к карте пациента, не закреплённого за врачом: по ПИН и причине, на 30 минут, с тревогой аудитору. */
function BreakGlass({ onChange }: { onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [reason, setReason] = useState("emergency");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [active, setActive] = useState<Grant[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const load = () => api<{ active: Grant[]; reasons: Record<string, string> }>("GET", "/api/breakglass").then((r) => { setActive(r.active); setReasons(r.reasons); }, () => {});
  useEffect(() => { void load(); }, []);
  const grant = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(""); setMsg("");
    try {
      const g = await api<Grant>("POST", "/api/breakglass", { pin: pin.replace(/\D/g, ""), reason });
      setPin(""); setMsg(`Доступ к карте «${g.name}» открыт до ${new Date(g.expiresAt).toLocaleTimeString("ru-RU", { timeStyle: "short" })}. Аудитор уведомлён.`);
      await load(); onChange();
    } catch (x) { setErr(x instanceof Error ? x.message : "Ошибка"); }
  };
  const end = async (id: string) => { await api("POST", "/api/breakglass/end", { patientId: id }); await load(); onChange(); };
  return (
    <section className="mt-6 rounded bg-white p-4 text-sm shadow-sm">
      <button className="font-medium text-red-800" onClick={() => setOpen((v) => !v)}>{open ? "▾" : "▸"} Экстренный доступ к карте</button>
      {active.length > 0 && (
        <ul className="mt-2 space-y-1">
          {active.map((a) => (
            <li key={a.patientId} className="flex flex-wrap items-center justify-between gap-2 rounded bg-red-50 p-2">
              <span>{a.name} · до {new Date(a.expiresAt).toLocaleTimeString("ru-RU", { timeStyle: "short" })}</span>
              <button onClick={() => end(a.patientId)} className="rounded border bg-white px-3 py-1 md:px-2 md:py-0.5">Закрыть доступ</button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <form onSubmit={grant} className="mt-3 space-y-2">
          <p className="text-slate-600">Только для неотложных случаев. Доступ на 30 минут: можно смотреть карту и вести приём, подписывать нельзя. Каждый случай записывается в журнал, аудитор получает тревогу.</p>
          <input className="w-full rounded border px-3 py-2 md:w-72" inputMode="numeric" placeholder="ПИН пациента (14 цифр)" value={pin} onChange={(e) => setPin(e.target.value)} />
          <select className="block w-full rounded border bg-white px-3 py-2 md:w-auto" value={reason} onChange={(e) => setReason(e.target.value)}>
            {Object.entries(reasons).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {err && <p className="text-red-600">{err}</p>}
          <button disabled={pin.replace(/\D/g, "").length !== 14} className="rounded bg-red-700 px-4 py-3 text-white disabled:opacity-50 md:py-2">Открыть доступ</button>
        </form>
      )}
      {msg && <p className="mt-2 text-green-700">{msg}</p>}
    </section>
  );
}

export default function Patients() {
  const [patients, setPatients] = useState<PatientView[] | null>(null);
  const [error, setError] = useState("");
  const load = () => api<{ patients: PatientView[] }>("GET", "/api/patients").then((r) => setPatients(r.patients), (e) => setError(e instanceof Error ? e.message : "Не удалось загрузить пациентов"));
  useEffect(() => { void load(); }, []);
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
      <BreakGlass onChange={load} />
    </div>
  );
}
