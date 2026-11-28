import { useState } from "react";
import { api, type Me } from "../api";

export default function Login({ onLogin, notice }: { onLogin: (me: Me) => void; notice?: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(await api<Me>("POST", "/api/login", { username, password, code }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
      setPassword("");
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto mt-4 max-w-sm space-y-3 rounded bg-white p-5 shadow-sm md:mt-16 md:p-6">
      <h1 className="text-lg font-semibold">Вход в MedSync</h1>
      {notice && <p role="status" className="rounded bg-amber-50 p-2 text-sm text-amber-900">{notice}</p>}
      <input className="w-full rounded border px-3 py-2" placeholder="Имя пользователя" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
      <input className="w-full rounded border px-3 py-2" placeholder="Пароль" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <input className="w-full rounded border px-3 py-2" placeholder="Код из приложения (6 цифр)" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={busy || !username || !password || code.length !== 6} className="w-full rounded bg-teal-600 py-3 text-white disabled:opacity-50">
        {busy ? "Вход…" : "Войти"}
      </button>
      <p className="text-xs text-slate-500">Демо-доступ с вымышленными учётными записями. Данные для входа создаёт `npm run seed`.</p>
    </form>
  );
}
