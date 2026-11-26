import { Resampler } from "./resample";

export const CAPTURE_RATE = 16_000;

export interface Capture {
  stop(): void;
}

export interface CaptureOptions {
  /** Запись прервалась не по воле врача: звонок, другое приложение взяло микрофон, система приостановила звук. */
  onInterrupt?: (reason: string) => void;
}

export const captureSupported = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== "undefined";

/** Просим 16 кГц; если браузер (Safari на iPhone) не умеет, берём его частоту и приводим к 16 кГц сами. */
function openContext(): AudioContext {
  try {
    const ctx = new AudioContext({ sampleRate: CAPTURE_RATE });
    if (ctx.sampleRate === CAPTURE_RATE) return ctx;
    void ctx.close();
  } catch {
    /* частота не поддерживается — откроем с частотой устройства */
  }
  return new AudioContext();
}

/**
 * Микрофон → блоки Float32 моно 16 кГц. Звук остаётся в памяти страницы:
 * он не воспроизводится, не записывается в файл и не хранится в браузере.
 * Экран не гаснет во время записи (Wake Lock), где это поддерживается.
 */
export async function startCapture(onFrame: (f: Float32Array) => void, options: CaptureOptions = {}): Promise<Capture> {
  if (!captureSupported()) throw new Error("Браузер не поддерживает захват звука. Откройте демо в Chrome, Edge или Safari.");
  // Контекст создаём сразу, пока жив жест пользователя: Safari иначе оставит его приостановленным.
  const ctx = openContext();
  let stopped = false;
  let stream: MediaStream | null = null;
  let lock: WakeLockSentinel | null = null;

  const cleanup = () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVisible);
    stream?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    void lock?.release().catch(() => {});
    lock = null;
    void ctx.close().catch(() => {});
  };
  const interrupt = (reason: string) => {
    if (stopped) return;
    cleanup();
    options.onInterrupt?.(reason);
  };
  const keepScreenOn = async () => {
    try {
      if (!stopped && !lock) {
        lock = (await navigator.wakeLock?.request("screen")) ?? null;
        lock?.addEventListener("release", () => { lock = null; });
      }
    } catch {
      /* экран может погаснуть — запись это не ломает */
    }
  };
  function onVisible() {
    if (document.visibilityState !== "visible" || stopped) return;
    void keepScreenOn(); // блокировка снимается, когда страница уходит в фон
    if (ctx.state !== "running") void ctx.resume().catch(() => {});
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    await ctx.resume();
    await ctx.audioWorklet.addModule("/pcm-worklet.js");
  } catch (e) {
    cleanup();
    throw e;
  }
  const resampler = ctx.sampleRate === CAPTURE_RATE ? null : new Resampler(ctx.sampleRate, CAPTURE_RATE);
  const source = ctx.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(ctx, "pcm-tap");
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const frame = resampler ? resampler.push(e.data) : e.data;
    if (frame.length) onFrame(frame);
  };
  // Узел подключаем к выходу через нулевое усиление, чтобы браузер его обрабатывал, но звука не было.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(tap).connect(mute).connect(ctx.destination);

  // Прерывания: микрофон отобрали (звонок, другое приложение) или система остановила звук.
  stream.getTracks().forEach((t) => { t.onended = () => interrupt("микрофон отключён"); });
  ctx.onstatechange = () => {
    // Safari ставит контекст на паузу при звонке или уходе в фон. Пробуем продолжить; не вышло — сообщаем врачу.
    if (stopped || ctx.state === "running") return;
    ctx.resume().catch(() => interrupt("звук остановлен системой"));
  };
  document.addEventListener("visibilitychange", onVisible);
  void keepScreenOn();

  return {
    stop() {
      if (stopped) return;
      tap.port.onmessage = null;
      ctx.onstatechange = null;
      source.disconnect();
      tap.disconnect();
      cleanup();
    },
  };
}
