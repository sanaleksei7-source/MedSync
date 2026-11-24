import { useEffect, useRef, useState } from "react";
import { docs, transcript, type DocType } from "../data/script";
import { patients } from "../data/patients";
import { formatPin } from "../data/pin";
import { findConflicts } from "../data/allergy";
import LiveTranscript from "./LiveTranscript";
import { addEntry, updateEntry } from "../data/history";

const patient = patients[0];
const plural = (n: number) =>
  n % 10 === 1 && n % 100 !== 11 ? "факт" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "факта" : "фактов";
const keyOf = (si: number, i: number) => `${si}-${i}`;

type Action = "kept" | "removed" | "edited";
interface Decision { action: Action; text?: string }
interface LogEntry { time: string; action: Action; before: string; after?: string }
const actionLabel: Record<Action, string> = { kept: "Оставлено", removed: "Убрано", edited: "Исправлено" };

const doctor = "Асанов Б. Т. (демо)";

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function Appointment() {
  const [docType, setDocType] = useState<DocType | null>(null);
  const [live, setLive] = useState(false);
  if (live) return <LiveTranscript onBack={() => setLive(false)} />;
  if (!docType)
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold">Какой документ оформить?</h1>
        <p className="text-sm text-slate-600">Пациент: {patient.name}. Один и тот же разговор — разные документы.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(Object.keys(docs) as DocType[]).map((t) => (
            <button key={t} onClick={() => setDocType(t)} className="rounded bg-white p-4 text-left shadow-sm hover:ring-2 hover:ring-teal-500">
              <div className="font-medium">{docs[t].label}</div>
              <div className="text-sm text-slate-500">{docs[t].hint}</div>
            </button>
          ))}
        </div>
        <button onClick={() => setLive(true)} className="rounded border border-dashed border-slate-400 p-3 text-left text-sm text-slate-600 hover:bg-white">
          🎙 Живая запись с микрофона (эксперимент)
        </button>
      </div>
    );
  return <Session key={docType} type={docType} onBack={() => setDocType(null)} />;
}

function Session({ type, onBack }: { type: DocType; onBack: () => void }) {
  const doc = docs[type].sections;
  const total = doc.reduce((n, s) => n + s.statements.length, 0);
  const [stage, setStage] = useState<"review" | "signed" | "sent">("review");
  const [sig, setSig] = useState<{ hash: string; time: string } | null>(null);
  const entryId = useRef(`h-${Date.now()}`);
  const [shown, setShown] = useState(0);
  const [hot, setHot] = useState<number[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [log, setLog] = useState<LogEntry[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [warn, setWarn] = useState(false);
  const [ackAllergy, setAckAllergy] = useState<number[]>([]);
  const [allergyWarn, setAllergyWarn] = useState(false);
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

  let filled = 0;
  const unchecked: string[] = [];
  doc.forEach((sec, si) =>
    sec.statements.forEach((st, i) => {
      if (!isVisible(st.sourceIds)) return;
      filled++;
      const k = keyOf(si, i);
      if (st.sourceIds.length === 0 && !decisions[k]) unchecked.push(k);
    }),
  );
  const conflicts = findConflicts(patient.allergies, transcript.slice(0, shown));
  const citing = (lineId: number) =>
    doc.flatMap((sec, si) =>
      sec.statements
        .map((st, i) => ({ st, k: keyOf(si, i) }))
        .filter(({ st, k }) => st.sourceIds.includes(lineId) && decisions[k]?.action !== "removed"),
    );
  const blocking = conflicts.filter((c) => citing(c.lineId).length > 0 && !ackAllergy.includes(c.lineId));
  const pct = Math.round((filled / total) * 100);

  const decide = (k: string, before: string, d: Decision) => {
    setDecisions((m) => ({ ...m, [k]: d }));
    setLog((l) => [
      ...l,
      { time: new Date().toLocaleTimeString("ru-RU"), action: d.action, before, after: d.text },
    ]);
    setEditing(null);
    setWarn(false);
  };

  const logNow = (action: Action, before: string, after?: string) =>
    setLog((l) => [...l, { time: new Date().toLocaleTimeString("ru-RU"), action, before, after }]);

  const ackConflict = (lineId: number, drug: string) => {
    setAckAllergy((a) => [...a, lineId]);
    setAllergyWarn(false);
    logNow("kept", `Назначение «${drug}» при аллергии — подтверждено врачом`);
  };

  const removeConflict = (lineId: number) => {
    const items = citing(lineId);
    setDecisions((m) => ({ ...m, ...Object.fromEntries(items.map(({ k }) => [k, { action: "removed" as Action }])) }));
    items.forEach(({ st }) => logNow("removed", st.text));
    setAllergyWarn(false);
  };

  const focusLine = (ids: number[]) => {
    setHot(ids);
    if (ids.length) lineRefs.current[ids[0]]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const finalSections = doc
    .map((sec, si) => ({
      title: sec.title,
      lines: sec.statements
        .map((st, i) => ({ st, d: decisions[keyOf(si, i)] }))
        .filter(({ st, d }) => isVisible(st.sourceIds) && d?.action !== "removed")
        .map(({ st, d }) => d?.text ?? st.text),
    }))
    .filter((s) => s.lines.length);

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
    const canonical = [docs[type].title, patient.pin, ...finalSections.flatMap((s) => [s.title, ...s.lines])].join("\n");
    const hash = await sha256(canonical);
    setSig({ hash, time: new Date().toLocaleString("ru-RU") });
    addEntry({ id: entryId.current, patientName: patient.name, time: new Date().toISOString(), docLabel: docs[type].label, status: "signed", hash });
    setStage("signed");
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
              <span className="text-slate-400">{e.time}</span> · <b>{actionLabel[e.action]}</b>: «{e.before}»
              {e.after !== undefined && <> → «{e.after}»</>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  if (stage !== "review")
    return (
      <div className="space-y-4">
        <article className="rounded bg-white p-6 shadow-sm print:shadow-none">
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
            <div className="font-medium text-teal-700">Подписано ЭЦП (демо — не имеет юридической силы)</div>
            <div>Врач: {doctor}</div>
            <div>Время: {sig?.time}</div>
            <div className="break-all font-mono">SHA-256: {sig?.hash}</div>
          </div>
        </article>
        {stage === "signed" ? (
          <div className="flex gap-2 print:hidden">
            <button onClick={() => { updateEntry(entryId.current, { status: "sent" }); setStage("sent"); }} className="rounded bg-teal-600 px-4 py-2 text-sm text-white">Отправить в медкарту</button>
            <button onClick={() => window.print()} className="rounded border px-4 py-2 text-sm">Печать / PDF</button>
          </div>
        ) : (
          <div className="space-y-2 print:hidden">
            <p className="rounded bg-green-50 p-3 text-sm text-green-800">
              Отправлено в медкарту пациента (демо: реальной интеграции с Түндүк пока нет, данные никуда не уходят).
            </p>
            <div className="flex gap-2">
              <button onClick={() => window.print()} className="rounded border px-4 py-2 text-sm">Печать / PDF</button>
              <button onClick={onBack} className="rounded bg-teal-600 px-4 py-2 text-sm text-white">Новый документ</button>
            </div>
          </div>
        )}
        <div className="print:hidden">{changeLog}</div>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
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
              <span className="ml-2 inline-flex gap-1">
                <button className="rounded border border-red-300 bg-white px-1.5" onClick={() => removeConflict(c.lineId)}>Убрать назначение</button>
                <button className="rounded border border-red-300 bg-white px-1.5" onClick={() => ackConflict(c.lineId, c.drug)}>Назначение проверено, оставить</button>
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
          <ol className="max-h-[28rem] space-y-1.5 overflow-y-auto text-sm">
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
                            <span className="ml-2 inline-flex gap-1">
                              <button className="rounded border bg-white px-1.5" onClick={() => decide(k, st.text, { action: "kept" })}>Оставить</button>
                              <button className="rounded border bg-white px-1.5" onClick={() => decide(k, st.text, { action: "removed" })}>Убрать</button>
                              <button className="rounded border bg-white px-1.5" onClick={() => { setDraft(st.text); setEditing(k); }}>Исправить</button>
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
          {allergyWarn && <p className="mb-1 text-sm text-red-600">Сначала решите вопрос с аллергией</p>}
          {warn && <p className="mb-1 text-sm text-red-600">Сначала проверьте жёлтые факты</p>}
          <button
            disabled={pct < 100}
            onClick={sign}
            className="mt-2 rounded bg-teal-600 px-4 py-2 text-sm text-white disabled:opacity-40"
          >
            Подписать ЭЦП
          </button>
        </section>
      </div>
      {changeLog}
    </div>
  );
}
