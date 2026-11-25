import { useEffect, useRef, useState } from "react";
import { docs, type DocType, type Section } from "../data/script";
import type { DraftSource } from "./Appointment";
import { api, apiAudio, ApiError } from "../api";
import { CAPTURE_RATE, captureSupported, startCapture, type Capture } from "../audio/capture";
import { Segmenter, toInt16 } from "../audio/segmenter";

interface Row {
  id: number;
  speaker: "Врач" | "Пациент";
  text: string;
  pending: boolean;
}

export default function LiveTranscript({
  onBack,
  onDraft,
}: {
  onBack: () => void;
  onDraft: (type: DocType, source: DraftSource) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const [speaker, setSpeaker] = useState<Row["speaker"]>("Врач");
  const [type, setType] = useState<DocType>("osmotr");
  const [busy, setBusy] = useState(false);
  const [dropped, setDropped] = useState(0);
  const speakerRef = useRef(speaker);
  speakerRef.current = speaker;
  const capture = useRef<Capture | null>(null);
  const segmenter = useRef<Segmenter | null>(null);
  const nextId = useRef(1);
  const queue = useRef<Promise<void>>(Promise.resolve());

  // Сегменты распознаются строго по очереди, чтобы реплики не менялись местами.
  const enqueue = (seg: Float32Array) => {
    const id = nextId.current++;
    setRows((r) => [...r, { id, speaker: speakerRef.current, text: "", pending: true }]);
    const pcm = toInt16(seg);
    queue.current = queue.current.then(async () => {
      try {
        const res = await apiAudio("/api/asr", pcm);
        if (res.text.trim()) setRows((r) => r.map((x) => (x.id === id ? { ...x, text: res.text.trim(), pending: false } : x)));
        else {
          setRows((r) => r.filter((x) => x.id !== id));
          setDropped((n) => n + 1);
        }
      } catch (e) {
        setRows((r) => r.filter((x) => x.id !== id));
        setError(e instanceof ApiError ? (e.status === 401 ? "Сессия истекла. Войдите заново." : e.message) : "Не удалось связаться с сервером");
      }
    });
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
      capture.current = await startCapture((frame) => seg.push(frame).forEach(enqueue));
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
      await queue.current; // дожидаемся последних сегментов
      const lines = rows.filter((r) => r.text.trim()).map((r) => ({ id: r.id, speaker: r.speaker, text: r.text.trim() }));
      if (lines.length === 0) throw new Error("Нет текста для документа");
      const data = await api<{ sections?: Section[] }>("POST", "/api/extract", {
        docTitle: docs[type].title,
        sectionTitles: docs[type].sections.map((s) => s.title),
        lines,
      });
      if (!data.sections) throw new Error("Не удалось составить документ");
      if (data.sections.length === 0) throw new Error("В разговоре не нашлось фактов для этого документа");
      onDraft(type, { lines, sections: data.sections });
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
        <p className="text-red-600">Этот браузер не поддерживает захват звука. Откройте демо в Chrome или Edge.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={recording ? stop : start} className={`rounded px-4 py-2 text-sm text-white ${recording ? "bg-red-600" : "bg-teal-600"}`}>
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
                <li key={r.id} className="flex items-center gap-2">
                  <span className="w-8 shrink-0 text-xs text-slate-400">#{r.id}</span>
                  <b className={`w-20 shrink-0 ${r.speaker === "Врач" ? "text-teal-700" : "text-slate-700"}`}>{r.speaker}:</b>
                  {r.pending ? (
                    <span className="text-slate-400">…</span>
                  ) : (
                    <>
                      <input
                        value={r.text}
                        onChange={(e) => setRows((all) => all.map((x) => (x.id === r.id ? { ...x, text: e.target.value } : x)))}
                        className="min-w-0 flex-1 rounded border border-transparent px-1 hover:border-slate-300 focus:border-teal-500"
                        aria-label={`Реплика ${r.id}`}
                      />
                      <button onClick={() => setRows((all) => all.filter((x) => x.id !== r.id))} className="text-slate-400 hover:text-red-600" aria-label={`Удалить реплику ${r.id}`}>✕</button>
                    </>
                  )}
                </li>
              ))}
            </ol>
            {dropped > 0 && <p className="mt-2 text-xs text-slate-400">Отброшено фрагментов без речи или с шумом: {dropped}</p>}
            {usable.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <select value={type} onChange={(e) => setType(e.target.value as DocType)} className="rounded border px-2 py-1">
                  {(Object.keys(docs) as DocType[]).map((t) => <option key={t} value={t}>{docs[t].label}</option>)}
                </select>
                <button disabled={busy || pending} onClick={makeDraft} className="rounded bg-teal-600 px-3 py-1 text-white disabled:opacity-50">
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
