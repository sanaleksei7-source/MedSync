export const CAPTURE_RATE = 16_000;

export interface Capture {
  stop(): void;
}

export const captureSupported = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== "undefined";

/**
 * Микрофон → блоки Float32 моно 16 кГц. Звук остаётся в памяти страницы:
 * он не воспроизводится, не записывается в файл и не хранится в браузере.
 */
export async function startCapture(onFrame: (f: Float32Array) => void): Promise<Capture> {
  if (!captureSupported()) throw new Error("Браузер не поддерживает захват звука. Откройте демо в Chrome или Edge.");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext({ sampleRate: CAPTURE_RATE });
  if (ctx.sampleRate !== CAPTURE_RATE) {
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
    throw new Error("Браузер не умеет захват на 16 кГц. Откройте демо в Chrome или Edge.");
  }
  await ctx.audioWorklet.addModule("/pcm-worklet.js");
  const source = ctx.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(ctx, "pcm-tap");
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => onFrame(e.data);
  // Узел подключаем к выходу через нулевое усиление, чтобы браузер его обрабатывал, но звука не было.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(tap).connect(mute).connect(ctx.destination);
  return {
    stop() {
      tap.port.onmessage = null;
      source.disconnect();
      tap.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}
