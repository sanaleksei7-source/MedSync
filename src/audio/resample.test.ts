import { Resampler } from "./resample";

const t: [string, boolean][] = [];
const tone = (hz: number, rate: number, seconds: number, amp = 0.5) =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => Math.sin((2 * Math.PI * hz * i) / rate) * amp);
const rms = (a: Float32Array, skip = 0) => {
  let s = 0;
  for (let i = skip; i < a.length - skip; i++) s += a[i] * a[i];
  return Math.sqrt(s / (a.length - 2 * skip));
};
const feedAll = (r: Resampler, a: Float32Array, chunk: number) => {
  const parts: Float32Array[] = [];
  for (let i = 0; i < a.length; i += chunk) parts.push(r.push(a.subarray(i, Math.min(i + chunk, a.length))));
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// 48 кГц → 16 кГц: длина, уровень и частота сохраняются
const a48 = tone(440, 48000, 2);
const o48 = feedAll(new Resampler(48000, 16000), a48, 128);
t.push(["48k→16k length ≈ n/3 (minus filter lookahead)", Math.abs(o48.length - 32000) <= 12]);
t.push(["48k→16k keeps level (±3%)", Math.abs(rms(o48, 400) / rms(tone(440, 16000, 2), 400) - 1) < 0.03]);
let crossings = 0;
for (let i = 1; i < o48.length; i++) if (o48[i - 1] < 0 && o48[i] >= 0) crossings++;
t.push(["48k→16k keeps frequency (440 Hz)", Math.abs(crossings / 2 - 440) < 8]);

// 44,1 кГц → 16 кГц (не целое отношение)
const o441 = feedAll(new Resampler(44100, 16000), tone(1000, 44100, 2), 128);
t.push(["44.1k→16k length", Math.abs(o441.length - 32000) <= 12]);
t.push(["44.1k→16k keeps level (±3%)", Math.abs(rms(o441, 400) / (0.5 / Math.SQRT2) - 1) < 0.03]);

// Частота выше половины 16 кГц не должна «сворачиваться» в слышимую
const alias = feedAll(new Resampler(48000, 16000), tone(12000, 48000, 1), 128);
t.push(["12 kHz tone is filtered out, not aliased", rms(alias, 400) < 0.03]);

// Нарезка блоками не влияет на результат
const whole = new Resampler(48000, 16000).push(a48);
const chunked = feedAll(new Resampler(48000, 16000), a48, 100);
t.push(["chunking does not change the output", whole.length === chunked.length && whole.every((v, i) => Math.abs(v - chunked[i]) < 1e-5)]);
const tiny = feedAll(new Resampler(48000, 16000), a48, 7);
t.push(["tiny chunks work too", tiny.length === whole.length && tiny.every((v, i) => Math.abs(v - whole[i]) < 1e-5)]);

// Постоянная составляющая и граничные случаи
const dc = new Resampler(48000, 16000).push(new Float32Array(4800).fill(0.25));
t.push(["DC level preserved", Math.abs(dc[dc.length - 1] - 0.25) < 0.01]);
t.push(["same rate: length preserved", feedAll(new Resampler(16000, 16000), tone(300, 16000, 1), 128).length >= 16000 - 20]);
t.push(["empty input gives empty output", new Resampler(48000, 16000).push(new Float32Array(0)).length === 0]);
t.push(["bad rates rejected", [() => new Resampler(0, 16000), () => new Resampler(48000, NaN)].every((f) => { try { f(); return false; } catch { return true; } })]);
const mem = new Resampler(48000, 16000);
for (let i = 0; i < 200; i++) mem.push(tone(300, 48000, 1));
t.push(["long stream still works (buffer is trimmed)", mem.push(tone(300, 48000, 0.1)).length > 1000]);

let bad = 0;
for (const [n, ok] of t) if (!ok) { bad++; console.error("FAIL", n); }
console.log(bad ? `BAD resample (${bad})` : `ok resample (${t.length})`);
if (bad) process.exitCode = 1;
