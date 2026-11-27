import { useEffect, useRef, useState } from "react";
import { docs, type DocType } from "../data/script";
import type { VisitView } from "../domain/visit";
import { api, apiAudio, ApiError } from "../api";
import { CAPTURE_RATE, captureSupported, startCapture, type Capture } from "../audio/capture";
import { Segmenter, toInt16 } from "../audio/segmenter";
import { applySuggestion, suggestDrug } from "../audio/suggest";

/** Слова, в которых модель сомневается (уверенность ниже порога), подсвечиваются. Порог выбран по малой выборке и требует перепроверки. */
const UNCERTAIN_BELOW = 0.7; // на 11 записях: при 0.5 ловится 49 % ошибок (7 % ложных тревог), при 0.7 — 76 % (20 %)

interface Row {
  id: number; // номер реплики на сервере; у ещё не распознанной — временный отрицательный
  saved: string; // текст, который сейчас хранит сервер (для сравнения при правке)
  speaker: "Врач" | "Пациент";
  text: string;
  words?: { w: string; p: number }[]; // уверенность модели по словам; пропадает, если врач правил текст
  pending: boolean;
}

export default function LiveTranscript({
  patientId,
  onBack,
  onDraft,
}: {
  patientId: string;
  onBack: () => void;
  onDraft: (visit: VisitView) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const [speaker, setSpeaker] = useState<Row["speaker"]>("Врач");
  const [type, setType] = useState<DocType>("osmotr");
  const [busy, setBusy] = useState(false);
  const [dropped, setDropped] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const speakerRef = useRef(speaker);
  speakerRef.current = speaker;
  const capture = useRef<Capture | null>(null);
  const segmenter = useRef<Segmenter | null>(null);
  const tempId = useRef(-1);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const visitId = useRef<string | null>(null);

  const failMsg = (e: unknown) => (e instanceof ApiError ? (e.status === 401 ? "Сессия истекла. Войдите заново." : e.message) : "Не удалось связаться с сервером");
  // Все обращения к серверу идут строго по очереди: реплики не меняются местами, правки не обгоняют распознавание.
  const run = (fn: () => Promise<void>) => { queue.current = queue.current.then(fn).catch((e) => setError(failMsg(e))); };

  // Расшифровку хранит сервер с самого начала: распознанный текст и каждая правка врача попадают в историю правок приёма.
  const ensureVisit = async () => {
    if (!visitId.current) visitId.current = (await api<VisitView>("POST", "/api/visits", { patientId, docType: type })).id;
    return visitId.current;
  };

  const enqueue = (seg: Float32Array) => {
    const tmp = tempId.current--;
    const sp = speakerRef.current;
    setRows((r) => [...r, { id: tmp, saved: "", speaker: sp, text: "", pending: true }]);
    const pcm = toInt16(seg);
    run(async () => {
      try {
        const id = await ensureVisit();
        const res = await apiAudio<{ line?: { id: number; speaker: Row["speaker"]; text: string }; words?: { w: string; p: number }[]; dropped?: string }>(`/api/visits/${id}/asr`, pcm, { "X-Speaker": sp === "Врач" ? "doctor" : "patient" });
        const line = res.line;
        if (line) setRows((r) => r.map((x) => (x.id === tmp ? { id: line.id, saved: line.text, speaker: line.speaker, text: line.text, words: res.words, pending: false } : x)));
        else {
          setRows((r) => r.filter((x) => x.id !== tmp));
          setDropped((n) => n + 1);
        }
      } catch (e) {
        setRows((r) => r.filter((x) => x.id !== tmp));
        throw e;
      }
    });
  };

  /** Правка врача уходит на сервер, когда он закончил редактировать строку. */
  const sendOps = (ops: object[], onSaved?: () => void) =>
    run(async () => {
      if (!visitId.current) return;
      await api<VisitView>("POST", `/api/visits/${visitId.current}/lines`, { ops });
      onSaved?.();
    });
  const commitEdit = (id: number) => {
    setEditing(null);
    const r = rows.find((x) => x.id === id);
    if (!r || r.pending || r.text.trim() === r.saved) return;
    if (!r.text.trim()) { remove(id); return; }
    const text = r.text.trim();
    sendOps([{ op: "edit", id, text }], () => setRows((all) => all.map((x) => (x.id === id ? { ...x, saved: text } : x))));
  };
  const remove = (id: number) => {
    setRows((all) => all.filter((x) => x.id !== id));
    sendOps([{ op: "delete", id }]);
  };

  const stop = () => {
    capture.current?.stop();
    capture.current = null;
    segmenter.current?.flush().forEach(enqueue);
    segmenter.current = null;
    setRecording(false);
  };

  const start = async () => {
    setError("");
    try {
      const seg = new Segmenter({ sampleRate: CAPTURE_RATE });
      segmenter.current = seg;
      capture.current = await startCapture((frame) => seg.push(frame).forEach(enqueue), {
        onInterrupt: (reason) => {
          // Не теряем то, что уже наговорили: дорасшифровываем остаток и просим начать запись снова.
          capture.current = null;
          segmenter.current?.flush().forEach(enqueue);
          segmenter.current = null;
          setRecording(false);
          setError(`Запись прервалась (${reason}). Проверьте текст и нажмите «Начать запись», чтобы продолжить.`);
        },
      });
      setRecording(true);
    } catch (e) {
      segmenter.current = null;
      setError(e instanceof Error && e.name === "NotAllowedError" ? "Нет доступа к микрофону. Разрешите его в настройках браузера." : e instanceof Error ? e.message : "Не удалось начать запись");
    }
  };

  useEffect(() => () => { capture.current?.stop(); }, []);

  const pending = rows.some((r) => r.pending);
  const usable = rows.filter((r) => !r.pending && r.text.trim());

  const makeDraft = async () => {
    stop();
    setBusy(true);
    setError("");
    try {
      if (editing !== null) commitEdit(editing);
      await queue.current; // дожидаемся последних сегментов и правок
      if (!visitId.current || !rows.some((r) => !r.pending && r.text.trim())) throw new Error("Нет текста для документа");
      // Текст уже на сервере; просим составить документ по тому, что хранит сервер.
      const visit = await api<VisitView>("POST", `/api/visits/${visitId.current}/extract`, { docType: type });
      if (!visit.sections) throw new Error("Не удалось составить документ");
      if (visit.sections.length === 0) throw new Error("В разговоре не нашлось фактов для этого документа");
      onDraft(visit);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети. Запущен ли сервер (npm run server)?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Живая запись <span className="text-sm font-normal text-amber-700">(эксперимент)</span></h1>
        <button onClick={() => { stop(); onBack(); }} className="rounded border px-3 py-1 text-sm">Назад</button>
      </div>
      <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        Звук обрабатывается только сервисом распознавания на компьютере клиники (адрес <code>ASR_URL</code>) и нигде не
        сохраняется. Только вымышленные данные: проверка на ошибки и юридическое разрешение ещё не пройдены.
        Распознавание ошибается, особенно в названиях препаратов и числах — <b>проверьте и поправьте каждую строку</b>{" "}
        перед составлением документа. Кнопка «Составить документ» отправляет текст языковой модели (Anthropic) — это отдельный
        шаг, он тоже допустим только для вымышленных данных.
      </div>
      {!captureSupported() ? (
        <p className="text-red-600">Этот браузер не поддерживает захват звука. Откройте демо в Chrome, Edge или Safari.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={recording ? stop : start} className={`w-full rounded px-4 py-3 text-base text-white sm:w-auto sm:py-2 sm:text-sm ${recording ? "bg-red-600" : "bg-teal-600"}`}>
              {recording ? "■ Стоп" : "● Начать запись"}
            </button>
            <span className="text-sm text-slate-600">Говорит:</span>
            {(["Врач", "Пациент"] as const).map((s) => (
              <button key={s} onClick={() => setSpeaker(s)} className={`rounded border px-3 py-1 text-sm ${speaker === s ? "bg-slate-800 text-white" : ""}`}>
                {s}
              </button>
            ))}
            {pending && <span className="text-sm text-slate-500">распознаю…</span>}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <section className="rounded bg-white p-4 shadow-sm">
            <h2 className="mb-2 font-medium">Расшифровка</h2>
            {rows.length === 0 && <p className="text-sm text-slate-500">Нажмите «Начать запись» и говорите. Фразы появляются после паузы.</p>}
            <ol className="space-y-1.5 text-sm">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 sm:flex-nowrap">
                  <span className="w-8 shrink-0 text-xs text-slate-400">{r.id > 0 ? `#${r.id}` : ""}</span>
                  <b className={`w-20 shrink-0 ${r.speaker === "Врач" ? "text-teal-700" : "text-slate-700"}`}>{r.speaker}:</b>
                  {r.pending ? (
                    <span className="text-slate-400">…</span>
                  ) : (
                    <div className="order-last min-w-0 basis-full sm:order-none sm:basis-0 sm:flex-1">
                      {editing === r.id || !r.words ? (
                        <input
                          autoFocus={editing === r.id}
                          value={r.text}
                          onChange={(e) => setRows((all) => all.map((x) => (x.id === r.id ? { ...x, text: e.target.value, words: undefined } : x)))}
                          onBlur={() => commitEdit(r.id)}
                          className="w-full rounded border border-transparent px-1 hover:border-slate-300 focus:border-teal-500"
                          aria-label={`Реплика ${r.id}`}
                        />
                      ) : (
                        <button type="button" onClick={() => setEditing(r.id)} className="w-full cursor-text rounded px-1 text-left hover:bg-slate-50" title="Нажмите, чтобы исправить">
                          {r.words.map((w, i) => (
                            <span
                              key={i}
                              title={w.p < UNCERTAIN_BELOW ? `Модель не уверена (${Math.round(w.p * 100)} %)` : /\d/.test(w.w) ? "Число: проверьте" : undefined}
                              className={w.p < UNCERTAIN_BELOW ? "rounded bg-yellow-200 px-0.5" : /\d/.test(w.w) ? "border-b-2 border-sky-400" : ""}
                            >
                              {w.w}{" "}
                            </span>
                          ))}
                        </button>
                      )}
                      {!r.pending && r.text.split(/\s+/).map((word) => ({ word, drug: suggestDrug(word) })).filter((x) => x.drug).map((x, i) => (
                        <div key={i} className="mt-0.5 text-xs text-amber-800">
                          Возможно, «{x.drug}», а не «{x.word.replace(/[^\p{L}]/gu, "")}»?{" "}
                          <button
                            className="rounded border border-amber-400 bg-amber-50 px-1.5"
                            onClick={() => {
                              const text = applySuggestion(r.text, x.word, x.drug!);
                              setRows((all) => all.map((y) => (y.id === r.id ? { ...y, text, words: undefined } : y)));
                              sendOps([{ op: "edit", id: r.id, text }], () => setRows((all) => all.map((y) => (y.id === r.id ? { ...y, saved: text } : y))));
                            }}
                          >
                            Заменить
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {!r.pending && (
                    <button onClick={() => remove(r.id)} className="ml-auto px-2 text-slate-400 hover:text-red-600 sm:ml-0" aria-label={`Удалить реплику ${r.id}`}>✕</button>
                  )}
                </li>
              ))}
            </ol>
            {rows.some((r) => r.words) && (
              <p className="mt-2 text-xs text-slate-500">
                <span className="rounded bg-yellow-200 px-0.5">жёлтым</span> — слова, в которых модель сомневается;{" "}
                <span className="border-b-2 border-sky-400">подчёркнутые</span> — числа. Модель бывает уверена и в ошибках, поэтому читайте всё.
              </p>
            )}
            {dropped > 0 && <p className="mt-2 text-xs text-slate-400">Отброшено фрагментов без речи или с шумом: {dropped}</p>}
            {usable.length > 0 && (
              <div className="mt-3 grid gap-2 text-sm sm:flex sm:flex-wrap sm:items-center">
                <select value={type} onChange={(e) => setType(e.target.value as DocType)} className="rounded border px-2 py-1">
                  {(Object.keys(docs) as DocType[]).map((t) => <option key={t} value={t}>{docs[t].label}</option>)}
                </select>
                <button disabled={busy || pending} onClick={makeDraft} className="rounded bg-teal-600 px-3 py-2 text-white disabled:opacity-50 sm:py-1">
                  {busy ? "Составляю…" : "Составить документ"}
                </button>
                <button className="rounded border px-3 py-1" onClick={() => navigator.clipboard?.writeText(usable.map((l) => `${l.speaker}: ${l.text}`).join("\n"))}>
                  Копировать текст
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
