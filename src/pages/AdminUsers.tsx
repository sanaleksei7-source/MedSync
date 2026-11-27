import { useEffect, useState } from "react";
import { api, ApiError } from "../api";

interface U { id: string; username: string; name: string; role: "doctor" | "admin" | "auditor"; assignedPatients: string[]; disabled: boolean; setup: string | null }
interface Secret { who: string; tempPassword: string; totpSecret?: string; uri?: string }
const roleLabel = { doctor: "Врач", admin: "Администратор", auditor: "Аудитор" } as const;
const input = "rounded border bg-white px-3 py-2";
const small = "rounded border px-3 py-1.5 text-sm md:px-2 md:py-0.5";

/** Управление пользователями. Администратор не видит медицинских данных: только учётные записи и номера закреплённых пациентов. */
export default function AdminUsers({ selfId }: { selfId: string }) {
  const [users, setUsers] = useState<U[] | null>(null);
  const [patientIds, setPatientIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState<Secret | null>(null);
  const [form, setForm] = useState({ username: "", name: "", role: "doctor" as U["role"], patients: "" });

  const load = () => api<{ users: U[]; patientIds: string[] }>("GET", "/api/admin/users").then((r) => { setUsers(r.users); setPatientIds(r.patientIds); }, (e) => setError(e.message));
  useEffect(() => { void load(); }, []);

  const run = async (fn: () => Promise<void>) => {
    setError("");
    try { await fn(); await load(); } catch (e) { setError(e instanceof ApiError ? e.message : "Ошибка"); }
  };
  const ids = (s: string) => s.split(/[\s,;]+/).filter(Boolean);

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api<{ user: U; tempPassword: string; totpSecret: string; uri: string }>("POST", "/api/admin/users", { username: form.username, name: form.name, role: form.role, assignedPatients: form.role === "doctor" ? ids(form.patients) : [] });
      setSecret({ who: r.user.username, tempPassword: r.tempPassword, totpSecret: r.totpSecret, uri: r.uri });
      setForm({ username: "", name: "", role: "doctor", patients: "" });
    });
  };
  const op = (u: U, what: "disable" | "enable" | "reset", body: unknown = {}) =>
    run(async () => {
      const r = await api<{ tempPassword?: string; totpSecret?: string; uri?: string }>("POST", `/api/admin/users/${u.id}/${what}`, body);
      if (r.tempPassword) setSecret({ who: u.username, tempPassword: r.tempPassword, totpSecret: r.totpSecret, uri: r.uri });
    });
  const assign = (u: U) => {
    const v = window.prompt(`Закреплённые пациенты для ${u.username} (номера через запятую; доступны: ${patientIds.join(", ")})`, u.assignedPatients.join(", "));
    if (v !== null) void run(async () => { await api("POST", `/api/admin/users/${u.id}/assign`, { patients: ids(v) }); });
  };

  if (!users) return error ? <p className="text-sm text-red-600">{error}</p> : <p className="text-sm text-slate-500">Загрузка…</p>;
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Пользователи</h2>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {secret && (
        <div className="space-y-1 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <b>Одноразовые данные для {secret.who}. Показаны один раз — передайте пользователю лично.</b>
          <div>Пароль: <span className="select-all font-mono">{secret.tempPassword}</span></div>
          {secret.totpSecret && <div className="break-all">Секрет второго фактора: <span className="select-all font-mono">{secret.totpSecret}</span></div>}
          <div className="text-slate-600">При первом входе пользователь обязан сменить пароль и заново подключить второй фактор.</div>
          <button className={small} onClick={() => setSecret(null)}>Скрыть</button>
        </div>
      )}
      <ul className="space-y-2">
        {users.map((u) => (
          <li key={u.id} className="rounded bg-white p-3 text-sm shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span><b>{u.username}</b> · {u.name} · {roleLabel[u.role]}</span>
              <span className="text-xs text-slate-500">{u.disabled ? "заблокирован" : u.setup ? "ждёт первого входа" : "активен"}{u.role === "doctor" ? ` · пациенты: ${u.assignedPatients.join(", ") || "—"}` : ""}</span>
            </div>
            {u.id !== selfId && (
              <div className="mt-2 flex flex-wrap gap-2">
                {u.disabled ? <button className={small} onClick={() => op(u, "enable")}>Разблокировать</button> : <button className={small} onClick={() => op(u, "disable")}>Заблокировать</button>}
                <button className={small} onClick={() => { if (window.confirm(`Сбросить пароль ${u.username}? Все его входы будут завершены.`)) void op(u, "reset"); }}>Сбросить пароль</button>
                <button className={small} onClick={() => { if (window.confirm(`Сбросить пароль и второй фактор ${u.username}? Все его входы будут завершены.`)) void op(u, "reset", { resetTotp: true }); }}>Сбросить пароль и второй фактор</button>
                {u.role === "doctor" && <button className={small} onClick={() => assign(u)}>Закреплённые пациенты</button>}
              </div>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={create} className="space-y-2 rounded bg-white p-4 shadow-sm">
        <h3 className="font-medium">Новый пользователь</h3>
        <div className="flex flex-wrap gap-2">
          <input className={input} placeholder="Имя для входа (латиница)" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <input className={input} placeholder="ФИО" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className={input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as U["role"] })}>
            {(Object.keys(roleLabel) as U["role"][]).map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
          </select>
          {form.role === "doctor" && <input className={input} placeholder={`Пациенты (${patientIds.join(", ")})`} value={form.patients} onChange={(e) => setForm({ ...form, patients: e.target.value })} />}
        </div>
        <button disabled={!form.username || !form.name} className="rounded bg-teal-600 px-4 py-3 text-sm text-white disabled:opacity-50 md:py-2">Создать</button>
      </form>
    </div>
  );
}
