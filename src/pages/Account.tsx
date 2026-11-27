import { useState } from "react";
import { api, ApiError, type Me } from "../api";

const input = "w-full rounded border bg-white px-3 py-2 md:w-72";
const btn = "rounded bg-teal-600 px-4 py-3 text-sm text-white disabled:opacity-50 md:py-2";
const group = (s: string) => s.replace(/(.{4})/g, "$1 ").trim();

/** Учётная запись: смена пароля и подключение второго фактора. При forced пользователь не может уйти, пока не закончит. */
export default function Account({ me, forced, onChanged, onRelogin }: { me: Me; forced: boolean; onChanged: () => void; onRelogin: () => void }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [code, setCode] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [tpPw, setTpPw] = useState("");
  const [secret, setSecret] = useState<{ secret: string; uri: string } | null>(null);
  const [tpCode, setTpCode] = useState("");
  const [tpErr, setTpErr] = useState("");
  const [tpMsg, setTpMsg] = useState("");

  const wrap = async (fn: () => Promise<void>, onErr: (m: string) => void) => {
    setBusy(true);
    try { await fn(); } catch (e) { onErr(e instanceof ApiError || e instanceof Error ? e.message : "Ошибка"); } finally { setBusy(false); }
  };

  const changePassword = (e: React.FormEvent) => {
    e.preventDefault();
    setPwErr(""); setPwMsg("");
    void wrap(async () => {
      const r = await api<{ relogin: boolean }>("POST", "/api/account/password", { current: cur, next, code });
      setCur(""); setNext(""); setCode("");
      setPwMsg("Пароль изменён. Остальные ваши входы завершены.");
      if (r.relogin) onRelogin(); else onChanged();
    }, setPwErr);
  };

  const startTotp = (e: React.FormEvent) => {
    e.preventDefault();
    setTpErr(""); setTpMsg("");
    void wrap(async () => { setSecret(await api<{ secret: string; uri: string }>("POST", "/api/account/totp/start", { password: tpPw })); setTpPw(""); }, setTpErr);
  };

  const confirmTotp = (e: React.FormEvent) => {
    e.preventDefault();
    setTpErr("");
    void wrap(async () => {
      const r = await api<{ relogin: boolean }>("POST", "/api/account/totp/confirm", { code: tpCode });
      setSecret(null); setTpCode("");
      setTpMsg("Второй фактор подключён. Старый секрет больше не действует.");
      if (r.relogin) onRelogin(); else onChanged();
    }, setTpErr);
  };

  const step = me.setup;
  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-xl font-semibold">{forced ? "Завершите настройку учётной записи" : "Учётная запись"}</h1>
      {forced && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">
          Вам выдали одноразовый пароль. {step === "password" ? "Сначала задайте свой пароль, затем" : "Пароль задан. Теперь"} подключите второй фактор заново: выданный администратором секрет перестанет действовать.
        </p>
      )}

      {step !== "totp" && (
        <form onSubmit={changePassword} className="space-y-2 rounded bg-white p-4 shadow-sm">
          <h2 className="font-medium">Смена пароля</h2>
          <input className={input} type="password" autoComplete="current-password" placeholder="Текущий пароль" value={cur} onChange={(e) => setCur(e.target.value)} />
          <input className={input} type="password" autoComplete="new-password" placeholder="Новый пароль (от 12 символов)" value={next} onChange={(e) => setNext(e.target.value)} />
          <input className={input} inputMode="numeric" autoComplete="one-time-code" placeholder="Код из приложения (6 цифр)" value={code} onChange={(e) => setCode(e.target.value)} />
          {pwErr && <p className="text-sm text-red-600">{pwErr}</p>}
          {pwMsg && <p className="text-sm text-green-700">{pwMsg}</p>}
          <button disabled={busy || !cur || !next || !code} className={btn}>Сменить пароль</button>
        </form>
      )}

      {step !== "password" && (
        <section className="space-y-2 rounded bg-white p-4 shadow-sm">
          <h2 className="font-medium">Второй фактор (приложение-аутентификатор)</h2>
          {!secret ? (
            <form onSubmit={startTotp} className="space-y-2">
              <p className="text-sm text-slate-600">{forced ? "Подключите приложение с новым секретом." : "Нужно при смене телефона или потере доступа к приложению."} Для начала подтвердите пароль.</p>
              <input className={input} type="password" autoComplete="current-password" placeholder="Пароль" value={tpPw} onChange={(e) => setTpPw(e.target.value)} />
              {tpErr && <p className="text-sm text-red-600">{tpErr}</p>}
              <button disabled={busy || !tpPw} className={btn}>Получить новый секрет</button>
            </form>
          ) : (
            <form onSubmit={confirmTotp} className="space-y-2">
              <p className="text-sm text-slate-600">Добавьте в приложение-аутентификатор (ключ вводится вручную, тип «по времени»). Секрет показывается один раз.</p>
              <p className="break-all rounded bg-slate-100 p-2 font-mono text-sm">{group(secret.secret)}</p>
              <a href={secret.uri} className="inline-block text-sm text-teal-700 underline">Открыть в приложении на этом телефоне</a>
              <input className={input} inputMode="numeric" autoComplete="one-time-code" placeholder="Код из приложения (6 цифр)" value={tpCode} onChange={(e) => setTpCode(e.target.value)} />
              {tpErr && <p className="text-sm text-red-600">{tpErr}</p>}
              <button disabled={busy || !tpCode} className={btn}>Подтвердить</button>
            </form>
          )}
          {tpMsg && <p className="text-sm text-green-700">{tpMsg}</p>}
        </section>
      )}
    </div>
  );
}
