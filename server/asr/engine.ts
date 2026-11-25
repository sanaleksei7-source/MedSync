// Распознавание речи на оборудовании клиники. Аудио уходит только в локальный сервис
// (например whisper.cpp server) и нигде не сохраняется: ни на диск, ни в журнал.

export const SAMPLE_RATE = 16_000;
export const MIN_SECONDS = 0.3;
export const MAX_SECONDS = 30;
/** Среднеквадратичная громкость ниже порога считается тишиной (шкала Int16). */
export const SILENCE_RMS = 150;

export interface AsrEngine {
  readonly name: string;
  /** PCM 16 кГц, моно, Int16. Возвращает текст сегмента. */
  transcribe(pcm: Int16Array): Promise<string>;
}

export function rms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / pcm.length);
}

/** WAV собирается в памяти; временных файлов нет. */
export function pcmToWav(pcm: Int16Array, sampleRate = SAMPLE_RATE): Buffer {
  const dataLen = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataLen);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataLen, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // моно
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataLen, 40);
  Buffer.from(pcm.buffer, pcm.byteOffset, dataLen).copy(buf, 44);
  return buf;
}

/** Читает 16-bit PCM моно 16 кГц WAV. Другие форматы отклоняются (конвертируйте ffmpeg-ом заранее). */
export function wavToPcm(wav: Buffer): Int16Array {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE")
    throw new Error("Не WAV-файл");
  let pos = 12;
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  while (pos + 8 <= wav.length) {
    const id = wav.toString("ascii", pos, pos + 4);
    const size = wav.readUInt32LE(pos + 4);
    if (id === "fmt ") {
      fmt = { format: wav.readUInt16LE(pos + 8), channels: wav.readUInt16LE(pos + 10), rate: wav.readUInt32LE(pos + 12), bits: wav.readUInt16LE(pos + 22) };
    } else if (id === "data") {
      if (!fmt) throw new Error("Нет блока fmt");
      if (fmt.format !== 1 || fmt.channels !== 1 || fmt.bits !== 16 || fmt.rate !== SAMPLE_RATE)
        throw new Error("Нужен WAV: PCM 16 бит, моно, 16000 Гц (ffmpeg -i in.mp3 -ac 1 -ar 16000 out.wav)");
      const end = Math.min(pos + 8 + size, wav.length);
      const bytes = wav.subarray(pos + 8, end - ((end - pos - 8) % 2));
      return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error("Нет блока data");
}

// ---- Политика адреса сервиса: аудио не должно случайно уйти за пределы клиники ----
const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export function assertAllowedAsrUrl(raw: string, allowRemote = false): URL {
  const u = new URL(raw);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const lan = PRIVATE_V4.test(host);
  if (loopback) return u; // та же машина: http допустим
  if (lan) {
    if (u.protocol !== "https:") throw new Error("ASR_URL в локальной сети должен быть https: аудио нельзя передавать открытым текстом");
    return u;
  }
  if (!allowRemote) throw new Error("ASR_URL указывает не на локальный адрес. Аудио пациентов нельзя отправлять вне клиники (ASR_ALLOW_REMOTE=1 снимает запрет, но только вместе с https и юридическим разрешением)");
  if (u.protocol !== "https:") throw new Error("Удалённый ASR_URL должен быть https");
  return u;
}

/** Типичные «галлюцинации» Whisper на тишине и шуме. Такой текст отбрасывается, а не попадает в протокол. */
const HALLUCINATIONS = [
  "продолжение следует",
  "субтитры",
  "спасибо за просмотр",
  "подписывайтесь на канал",
  "редактор субтитров",
  "до новых встреч",
];
const norm = (s: string) =>
  s.toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

export function isHallucination(text: string): boolean {
  const n = norm(text);
  return n.length > 0 && HALLUCINATIONS.some((h) => n.includes(h));
}

// ---- Движки ----

/** Для проверки цепочки микрофон → сервер без модели. Текст помечен явно. */
export class MockEngine implements AsrEngine {
  readonly name = "mock";
  private n = 0;
  async transcribe(pcm: Int16Array): Promise<string> {
    this.n++;
    return `[тестовое распознавание ${this.n}: ${(pcm.length / SAMPLE_RATE).toFixed(1)} с]`;
  }
}

/** whisper.cpp `whisper-server`: POST /inference (multipart: file, language, response_format=json) → {"text": "..."}. */
export class HttpWhisperEngine implements AsrEngine {
  readonly name = "whisper.cpp-http";
  private base: URL;
  constructor(url: string, allowRemote = false, private timeoutMs = 60_000) {
    this.base = assertAllowedAsrUrl(url, allowRemote);
  }
  async transcribe(pcm: Int16Array): Promise<string> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(pcmToWav(pcm))], { type: "audio/wav" }), "segment.wav");
    form.append("language", "ru");
    form.append("temperature", "0.0");
    form.append("response_format", "json");
    const r = await fetch(new URL("/inference", this.base), { method: "POST", body: form, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!r.ok) throw new Error(`ASR service returned ${r.status}`);
    const data = (await r.json()) as { text?: unknown };
    if (typeof data.text !== "string") throw new Error("ASR service returned an unexpected response");
    return data.text.trim();
  }
}

export function engineFromEnv(env: NodeJS.ProcessEnv): AsrEngine | null {
  if (env.ASR_ENGINE === "mock") return new MockEngine();
  if (env.ASR_URL) return new HttpWhisperEngine(env.ASR_URL, env.ASR_ALLOW_REMOTE === "1");
  return null;
}
