import { useEffect, useRef, useState } from "react";
import { docs, type DocType } from "../data/script";
import { formatPin } from "../data/pin";
import { findConflicts } from "../data/allergy";
import LiveTranscript from "./LiveTranscript";
import { api, ApiError } from "../api";
import { blockingConflicts, finalizeSections, keyOf, uncheckedKeys, type Action, type Decision } from "../domain/rules";
import type { VisitView } from "../domain/visit";
import type { PatientView } from "../domain/patient";

const plural = (n: number) =>
  n % 10 === 1 && n % 100 !== 11 ? "факт" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "факта" : "фактов";
const actionLabel: Record<Action, string> = { kept: "Оставлено", removed: "Убрано", edited: "Исправлено" };

export default function Appointment({ resumeId, onResumed }: { resumeId: string | null; onResumed: () => void }) {
  const [live, setLive] = useState(false);
  const [visit, setVisit] = useState<VisitView | null>(null);
  const [resumed, setResumed] = useState(false);
  const [patients, setPatients] = useState<PatientView[] | null>(null);
  const [patientId, setPatientId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Пациентов отдаёт сервер: только тех, кто закреплён за врачом.
  useEffect(() => {
    api<{ patients: PatientView[] }>("GET", "/api/patients").then(
      (r) => { setPatients(r.patients); setPatientId((cur) => cur || r.patients[0]?.id || ""); },
      (e) => setError(e instanceof Error ? e.message : "Не удалось загрузить пациентов"),
    );
  }, []);

  // Продолжение приёма из истории: сервер отдаёт сохранённый черновик и решения врача.
  useEffect(() => {
    if (!resumeId) return;
    api<VisitView>("GET", `/api/visits/${resumeId}`).then(
      (v) => { setVisit(v); setResumed(true); },
      (e) => setError(e instanceof Error ? e.message : "Не удалось открыть приём"),
    ).finally(onResumed);
  }, [resumeId]);
  const patient = patients?.find((p) => p.id === patientId);

  // Приём создаёт и хранит сервер; демо-разговор и шаблон документа сервер берёт сам.
  const startDemo = async (docType: DocType) => {
    setBusy(true);
    setError("");
    try {
      setVisit(await api<VisitView>("POST", "/api/visits", { patientId, docType, demo: true }));
      setResumed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось начать приём");
    } finally {
      setBusy(false);
    }
  };

  if (visit) return <Session key={visit.id} initial={visit} resumed={resumed} onBack={() => setVisit(null)} />;
  if (live && patient) return <LiveTranscript patientId={patient.id} onBack={() => setLive(false)} onDraft={(v) => { setResumed(false); setVisit(v); }} />;
  if (resumeId) return <p className="text-sm text-slate-500">Открываю приём…</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Какой документ оформить?</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {patients && patients.length === 0 && !error && <p className="text-sm text-slate-600">За вами пока не закреплён ни один пациент.</p>}
      {patients && patients.length > 0 && (
        <label className="block text-sm text-slate-600">
          Пациент
          <select value={patientId} onChange={(e) => setPatientId(e.target.value)} className="mt-1 block w-full rounded border bg-white px-2 py-2 text-slate-900 md:w-auto">
            {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      <p className="text-sm text-slate-600">Один и тот же разговор — разные документы.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(docs) as DocType[]).map((t) => (
          <button key={t} disabled={busy || !patient} onClick={() => startDemo(t)} className="rounded bg-white p-4 text-left shadow-sm hover:ring-2 hover:ring-teal-500 disabled:opacity-50">
            <div className="font-medium">{docs[t].label}</div>
            <div className="text-sm text-slate-500">{docs[t].hint}</div>
          </button>
        ))}
      </div>
      <button disabled={!patient} onClick={() => setLive(true)} className="rounded border border-dashed border-slate-400 p-3 text-left text-sm text-slate-600 hover:bg-white disabled:opacity-50">
        🎙 Живая запись с микрофона (эксперимент)
      </button>
    </div>
  );
}

function Session({ initial, resumed, onBack }: { initial: VisitView; resumed: boolean; onBack: () => void }) {
  const [visit, setVisit] = useState(initial);
  const patient = visit.patient;
  const type = visit.docType;
  const transcript = visit.lines;
  const doc = visit.sections ?? [];
  const decisions = visit.decisions;
  const log = visit.changeLog;
  const sig = visit.signed;
  const ackAllergy = visit.ackAllergy;
  const total = doc.reduce((n, s) => n + s.statements.length, 0);
  const [sent, setSent] = useState(false);
  const [signError, setSignError] = useState("");
  // В демо разговор «идёт»: реплики появляются по одной. В живом приёме всё уже расшифровано.
  const [shown, setShown] = useState(visit.source === "demo" && !resumed ? 0 : visit.lines.length);
  const [hot, setHot] = useState<number[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [warn, setWarn] = useState(false);
  const [allergyWarn, setAllergyWarn] = useState(false);
  const [busy, setBusy] = useState(false);
  const lineRefs = useRef<Record<number, HTMLLIElement | null>>({});
  const stmtRefs = useRef<Record<string, HTMLLIElement | null>>({});

  useEffect(() => {
    if (shown >= transcript.length) return;
    const t = setTimeout(() => setShown((s) => s + 1), 1800);
    return () => clearTimeout(t);
  }, [shown]);

  const done = shown >= transcript.length;
  const visibleIds = new Set(transcript.slice(0, shown).map((l) => l.id));
  const isVisible = (ids: number[]) => (ids.length === 0 ? done : ids.every((id) => visibleIds.has(id)));

  const filled = doc.reduce((n, sec) => n + sec.statements.filter((st) => isVisible(st.sourceIds)).length, 0);
  const unchecked = uncheckedKeys(doc, decisions, isVisible);
  const conflicts = findConflicts(patient.allergies, transcript.slice(0, shown));
  const citing = (lineId: number) =>
    doc.flatMap((sec, si) =>
      sec.statements
        .map((st, i) => ({ st, k: keyOf(si, i) }))
        .filter(({ st, k }) => st.sourceIds.includes(lineId) && decisions[k]?.action !== "removed"),
    );
  const blocking = blockingConflicts(doc, decisions, conflicts, ackAllergy);
  const pct = total ? Math.round((filled / total) * 100) : 0;

  // Решения врача сохраняются на сервере; экран всегда показывает то, что вернул сервер.
  const send = async (path: "decisions" | "sign", body: unknown) => {
    setBusy(true);
    setSignError("");
    try {
      const v = await api<VisitView>("POST", `/api/visits/${visit.id}/${path}`, body);
      setVisit(v);
      return v;
    } catch (e) {
      setSignError(e instanceof ApiError ? e.message : "Не удалось сохранить");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const decide = async (k: string, _before: string, d: Decision) => {
    const v = await send("decisions", { changes: [{ key: k, action: d.action, ...(d.text !== undefined ? { text: d.text } : {}) }] });
    if (v) { setEditing(null); setWarn(false); }
  };

  const ackConflict = async (lineId: number) => {
    if (await send("decisions", { ack: [lineId] })) setAllergyWarn(false);
  };

  const removeConflict = async (lineId: number) => {
    const items = citing(lineId);
    if (items.length && (await send("decisions", { changes: items.map(({ k }) => ({ key: k, action: "removed" as Action })) }))) setAllergyWarn(false);
  };

  const focusLine = (ids: number[]) => {
    setHot(ids);
    if (ids.length) lineRefs.current[ids[0]]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const finalSections = finalizeSections(doc, decisions, isVisible);

  const sign = async () => {
    if (blocking.length) {
      setAllergyWarn(true);
      return;
    }
    if (unchecked.length) {
      setWarn(true);
      stmtRefs.current[unchecked[0]]?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // Сервер сам перепроверяет правила и подписывает то, что хранит; от клиента приходит только команда.
    await send("sign", {});
  };

  const changeLog = (
    <div className="mt-4 rounded bg-white p-4 text-sm shadow-sm">
      <h2 className="mb-2 font-medium">Журнал изменений</h2>
      {log.length === 0 ? (
        <p className="text-slate-500">Пока нет действий врача.</p>
      ) : (
        <ul className="space-y-1">
          {log.map((e, i) => (
            <li key={i}>
              <span className="text-slate-400">{new Date(e.time).toLocaleTimeString("ru-RU")}</span> · <b>{actionLabel[e.action]}</b>: «{e.before}»
              {e.after !== undefined && <> → «{e.after}»</>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  if (visit.status === "signed")
    return (
      <div className="space-y-4">
        <article className="rounded bg-white p-4 shadow-sm md:p-6 print:shadow-none">
          <h1 className="text-lg font-semibold">{docs[type].title}</h1>
          <p className="mb-3 text-sm text-slate-600">
            {patient.name} · ПИН <span className="font-mono">{formatPin(patient.pin)}</span>
          </p>
          {finalSections.map((s) => (
            <div key={s.title} className="mb-2">
              <h3 className="text-sm font-semibold text-slate-600">{s.title}</h3>
              <ul className="list-disc pl-5 text-sm">{s.lines.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          ))}
          <div className="mt-4 border-t pt-3 text-xs text-slate-600">
            <div className="font-medium text-teal-700">Подписано (демо — НЕ электронная цифровая подпись, юридической силы не имеет)</div>
            <div>Врач: {sig?.signer}</div>
            <div>Схема: {sig?.scheme}</div>
            <div>Время: {sig ? new Date(sig.signedAt).toLocaleString("ru-RU") : ""}</div>
            <div className="break-all font-mono">SHA-256: {sig?.hash}</div>
          </div>
        </article>
        {!sent ? (
          <div className="flex flex-col gap-2 sm:flex-row print:hidden">
            <button onClick={() => setSent(true)} className="rounded bg-teal-600 px-4 py-3 text-sm text-white sm:py-2">Отправить в медкарту</button>
            <button onClick={() => window.print()} className="rounded border px-4 py-3 text-sm sm:py-2">Печать / PDF</button>
          </div>
        ) : (
          <div className="space-y-2 print:hidden">
            <p className="rounded bg-green-50 p-3 text-sm text-green-800">
              Отправлено в медкарту пациента (демо: реальной интеграции с Түндүк пока нет, данные никуда не уходят).
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button onClick={() => window.print()} className="rounded border px-4 py-3 text-sm sm:py-2">Печать / PDF</button>
              <button onClick={onBack} className="rounded bg-teal-600 px-4 py-3 text-sm text-white sm:py-2">Новый документ</button>
            </div>
          </div>
        )}
        <div className="print:hidden">{changeLog}</div>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h1 className="text-xl font-semibold">{patient.name} <span className="text-sm font-normal text-slate-500">· {docs[type].label}</span></h1>
        <span className="text-sm text-slate-600">
          ПИН <span className="font-mono">{formatPin(patient.pin)}</span>
        </span>
      </div>
      {patient.allergies.length > 0 && (
        <p className="text-sm text-slate-600">Аллергии: <b>{patient.allergies.join(", ")}</b></p>
      )}
      {conflicts.map((c) => {
        const open = blocking.includes(c);
        return (
          <div key={c.lineId} className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            <b>⚠ Аллергия на {c.allergen}.</b> В реплике #{c.lineId} назначен «{c.drug}» (та же группа препаратов).
            {open ? (
              <span className="mt-2 flex flex-wrap gap-2 md:ml-2 md:mt-0 md:inline-flex md:gap-1">
                <button className="rounded border border-red-300 bg-white px-3 py-1 md:px-1.5 md:py-0" onClick={() => removeConflict(c.lineId)}>Убрать назначение</button>
                <button className="rounded border border-red-300 bg-white px-3 py-1 md:px-1.5 md:py-0" onClick={() => ackConflict(c.lineId)}>Назначение проверено, оставить</button>
              </span>
            ) : (
              <span className="ml-2 text-xs text-red-700">решено врачом (см. журнал)</span>
            )}
          </div>
        );
      })}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded bg-white p-4 shadow-sm">
          <h2 className="mb-2 font-medium">Разговор <span className="text-xs font-normal text-amber-700">(сценарий, демо)</span></h2>
          <ol className="max-h-64 space-y-1.5 md:max-h-[28rem] overflow-y-auto text-sm">
            {transcript.slice(0, shown).map((l) => (
              <li
                key={l.id}
                ref={(el) => { lineRefs.current[l.id] = el; }}
                className={`rounded p-1.5 ${conflicts.some((c) => c.lineId === l.id) ? "bg-red-100" : hot.includes(l.id) ? "bg-teal-100" : ""}`}
              >
                <span className="mr-1 text-xs text-slate-400">#{l.id}</span>
                <b className={l.speaker === "Врач" ? "text-teal-700" : "text-slate-700"}>{l.speaker}:</b> {l.text}
              </li>
            ))}
          </ol>
        </section>
        <section className="rounded bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-medium">Документ <span className="text-sm font-normal text-slate-500">{pct}%</span></h2>
            {done &&
              (unchecked.length ? (
                <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800">
                  {unchecked.length} {plural(unchecked.length)} без источника
                </span>
              ) : (
                <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">Всё проверено</span>
              ))}
          </div>
          {doc.map((sec, si) => {
            const items = sec.statements
              .map((st, i) => ({ st, k: keyOf(si, i) }))
              .filter(({ st, k }) => isVisible(st.sourceIds) && decisions[k]?.action !== "removed");
            if (!items.length) return null;
            return (
              <div key={sec.title} className="mb-3">
                <h3 className="text-sm font-semibold text-slate-600">{sec.title}</h3>
                <ul className="space-y-1 text-sm">
                  {items.map(({ st, k }) => {
                    const d = decisions[k];
                    const flagged = st.sourceIds.length === 0 && !d;
                    const text = d?.text ?? st.text;
                    return (
                      <li
                        key={k}
                        ref={(el) => { stmtRefs.current[k] = el; }}
                        className={`rounded px-1.5 py-0.5 ${flagged ? "bg-yellow-100" : ""}`}
                        onMouseEnter={() => focusLine(st.sourceIds)}
                        onMouseLeave={() => setHot([])}
                      >
                        {editing === k ? (
                          <div className="flex gap-1">
                            <input
                              autoFocus
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              className="flex-1 rounded border px-1"
                            />
                            <button className="rounded bg-teal-600 px-2 text-white" onClick={() => decide(k, st.text, { action: "edited", text: draft })}>OK</button>
                            <button className="rounded border px-2" onClick={() => setEditing(null)}>Отмена</button>
                          </div>
                        ) : (
                          <>
                            {text}
                            {st.sourceIds.map((id) => (
                              <span key={id} className="ml-1 rounded bg-slate-200 px-1 text-xs text-slate-600">#{id}</span>
                            ))}
                            {d && <span className="ml-1 text-xs text-slate-400">({actionLabel[d.action].toLowerCase()})</span>}
                          </>
                        )}
                        {flagged && editing !== k && (
                          <div className="mt-1 text-xs text-yellow-900">
                            Это не прозвучало в разговоре
                            <span className="mt-1 flex flex-wrap gap-2 md:ml-2 md:mt-0 md:inline-flex md:gap-1">
                              <button className="rounded border bg-white px-3 py-1 md:px-1.5 md:py-0" onClick={() => decide(k, st.text, { action: "kept" })}>Оставить</button>
                              <button className="rounded border bg-white px-3 py-1 md:px-1.5 md:py-0" onClick={() => decide(k, st.text, { action: "removed" })}>Убрать</button>
                              <button className="rounded border bg-white px-3 py-1 md:px-1.5 md:py-0" onClick={() => { setDraft(st.text); setEditing(k); }}>Исправить</button>
                            </span>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {signError && <p className="mb-1 text-sm text-red-600">{signError}</p>}
          {allergyWarn && <p className="mb-1 text-sm text-red-600">Сначала решите вопрос с аллергией</p>}
          {warn && <p className="mb-1 text-sm text-red-600">Сначала проверьте жёлтые факты</p>}
          <button
            disabled={pct < 100 || busy}
            onClick={sign}
            className="sticky bottom-20 z-10 mt-2 w-full rounded bg-teal-600 px-4 py-3 text-sm text-white shadow-lg disabled:opacity-40 md:static md:w-auto md:py-2 md:shadow-none"
          >
            Подписать ЭЦП
          </button>
        </section>
      </div>
      {changeLog}
    </div>
  );
}
