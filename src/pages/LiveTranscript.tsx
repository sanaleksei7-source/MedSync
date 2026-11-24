import { useEffect, useRef, useState } from "react";
import { docs, type DocType, type Section } from "../data/script";
import type { DraftSource } from "./Appointment";

// Минимальные типы Web Speech API (в lib.dom TypeScript их нет).
interface SRResult { isFinal: boolean; 0: { transcript: string } }
interface SREvent { resultIndex: number; results: ArrayLike<SRResult> }
interface SR {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

const Ctor: (new () => SR) | undefined =
  typeof window !== "undefined"
    ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition)
    : undefined;

interface Line { id: number; speaker: "Врач" | "Пациент"; text: string }

export default function LiveTranscript({
  onBack,
  onDraft,
}: {
  onBack: () => void;
  onDraft: (type: DocType, source: DraftSource) => void;
}) {
  const [type, setType] = useState<DocType>("osmotr");
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [interim, setInterim] = useState("");
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const [speaker, setSpeaker] = useState<Line["speaker"]>("Врач");
  const speakerRef = useRef(speaker);
  speakerRef.current = speaker;
  const rec = useRef<SR | null>(null);
  const wantOn = useRef(false);

  const stop = () => {
    wantOn.current = false;
    rec.current?.stop();
    setListening(false);
    setInterim("");
  };

  const start = () => {
    if (!Ctor) return;
    setError("");
    const r = new Ctor();
    r.lang = "ru-RU";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let tmp = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0].transcript.trim();
        if (res.isFinal) {
          if (text) setLines((l) => [...l, { id: l.length + 1, speaker: speakerRef.current, text }]);
        } else tmp += res[0].transcript;
      }
      setInterim(tmp);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed") setError("Нет доступа к микрофону. Разрешите его в настройках браузера.");
      else if (e.error !== "no-speech" && e.error !== "aborted") setError(`Ошибка распознавания: ${e.error}`);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") stop();
    };
    // Chrome сам завершает сессию после паузы — перезапускаем, пока врач не нажал «Стоп».
    r.onend = () => {
      if (wantOn.current) r.start();
      else setListening(false);
    };
    rec.current = r;
    wantOn.current = true;
    r.start();
    setListening(true);
  };

  const makeDraft = async () => {
    stop();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docTitle: docs[type].title, sectionTitles: docs[type].sections.map((s) => s.title), lines }),
      });
      const data = (await r.json()) as { sections?: Section[]; error?: string };
      if (!r.ok || !data.sections) throw new Error(data.error ?? "Не удалось составить документ");
      if (data.sections.length === 0) throw new Error("В разговоре не нашлось фактов для этого документа");
      onDraft(type, { lines, sections: data.sections });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети. Запущен ли сервер (npm run server)?");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => () => { wantOn.current = false; rec.current?.stop(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Живая запись <span className="text-sm font-normal text-amber-700">(эксперимент)</span></h1>
        <button onClick={() => { stop(); onBack(); }} className="rounded border px-3 py-1 text-sm">Назад</button>
      </div>
      <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        Распознавание выполняет сам браузер: в Chrome и Edge аудио отправляется на серверы Google/Microsoft.
        Не используйте с реальными пациентами. Кнопка «Составить документ» отправляет расшифровку модели Claude (Anthropic) через локальный сервер — тоже только для вымышленных данных. Нужен ANTHROPIC_API_KEY (см. README).
      </div>
      {!Ctor ? (
        <p className="text-red-600">Этот браузер не поддерживает распознавание речи. Откройте демо в Chrome или Edge.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={listening ? stop : start}
              className={`rounded px-4 py-2 text-sm text-white ${listening ? "bg-red-600" : "bg-teal-600"}`}
            >
              {listening ? "■ Стоп" : "● Начать запись"}
            </button>
            <span className="text-sm text-slate-600">Говорит:</span>
            {(["Врач", "Пациент"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSpeaker(s)}
                className={`rounded border px-3 py-1 text-sm ${speaker === s ? "bg-slate-800 text-white" : ""}`}
              >
                {s}
              </button>
            ))}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <section className="rounded bg-white p-4 shadow-sm">
            <h2 className="mb-2 font-medium">Расшифровка</h2>
            {lines.length === 0 && !interim && <p className="text-sm text-slate-500">Нажмите «Начать запись» и говорите.</p>}
            <ol className="space-y-1.5 text-sm">
              {lines.map((l) => (
                <li key={l.id}>
                  <span className="mr-1 text-xs text-slate-400">#{l.id}</span>
                  <b className={l.speaker === "Врач" ? "text-teal-700" : "text-slate-700"}>{l.speaker}:</b> {l.text}
                </li>
              ))}
              {interim && <li className="text-slate-400">{interim}…</li>}
            </ol>
            {lines.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <select value={type} onChange={(e) => setType(e.target.value as DocType)} className="rounded border px-2 py-1">
                  {(Object.keys(docs) as DocType[]).map((t) => <option key={t} value={t}>{docs[t].label}</option>)}
                </select>
                <button disabled={busy} onClick={makeDraft} className="rounded bg-teal-600 px-3 py-1 text-white disabled:opacity-50">
                  {busy ? "Составляю…" : "Составить документ"}
                </button>
              </div>
            )}
            {lines.length > 0 && (
              <button
                className="mt-3 rounded border px-3 py-1 text-sm"
                onClick={() => navigator.clipboard?.writeText(lines.map((l) => `${l.speaker}: ${l.text}`).join("\n"))}
              >
                Копировать текст
              </button>
            )}
          </section>
        </>
      )}
    </div>
  );
}
