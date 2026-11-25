import { Segmenter, toInt16 } from "./segmenter";

const SR = 16000;
const FRAME = 128;
const tone = (ms: number, amp: number) => Float32Array.from({ length: Math.round((ms / 1000) * SR) }, (_, i) => Math.sin(i / 6) * amp);
const quiet = (ms: number) => Float32Array.from({ length: Math.round((ms / 1000) * SR) }, () => (Math.random() - 0.5) * 0.004);

function feed(seg: Segmenter, audio: Float32Array): Float32Array[] {
  const out: Float32Array[] = [];
  for (let i = 0; i < audio.length; i += FRAME) out.push(...seg.push(audio.subarray(i, Math.min(i + FRAME, audio.length))));
  return out;
}
const concat = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const secs = (f: Float32Array) => f.length / SR;

const t: [string, boolean][] = [];

// Чистая тишина и шум: ничего не отправляется
{
  const s = new Segmenter({ sampleRate: SR });
  const out = [...feed(s, quiet(5000)), ...s.flush()];
  t.push(["silence produces no segments", out.length === 0]);
}

// Одна фраза посреди тишины
{
  const s = new Segmenter({ sampleRate: SR });
  const out = feed(s, concat(quiet(1000), tone(2000, 0.2), quiet(1500)));
  t.push(["one phrase → one segment", out.length === 1]);
  t.push(["segment has the phrase and short tail, not all the silence", out.length === 1 && secs(out[0]) > 2.0 && secs(out[0]) < 3.6]);
  t.push(["pre-roll keeps a bit of the lead-in", out.length === 1 && secs(out[0]) > 2.0 + 0.2]);
}

// Две фразы с паузой
{
  const s = new Segmenter({ sampleRate: SR });
  const out = feed(s, concat(quiet(500), tone(1500, 0.2), quiet(1200), tone(1000, 0.2), quiet(1200)));
  t.push(["two phrases → two segments", out.length === 2]);
}

// Короткая пауза внутри фразы не режет её
{
  const s = new Segmenter({ sampleRate: SR });
  const out = feed(s, concat(quiet(300), tone(800, 0.2), quiet(300), tone(800, 0.2), quiet(1500)));
  t.push(["short pause does not split a phrase", out.length === 1 && secs(out[0]) > 1.8]);
}

// Длинная речь режется по предельной длине
{
  const s = new Segmenter({ sampleRate: SR, maxMs: 5000 });
  const out = feed(s, concat(quiet(300), tone(12_000, 0.2), quiet(1500)));
  t.push(["long speech is cut at max length", out.length >= 2 && out.every((x) => secs(x) <= 5.2)]);
}

// Клик короче минимума отбрасывается
{
  const s = new Segmenter({ sampleRate: SR });
  const out = feed(s, concat(quiet(500), tone(100, 0.3), quiet(1500)));
  t.push(["very short click is dropped", out.length === 0]);
}

// Остановка записи отдаёт недосказанную фразу
{
  const s = new Segmenter({ sampleRate: SR });
  const out = feed(s, concat(quiet(500), tone(1500, 0.2)));
  const rest = s.flush();
  t.push(["flush returns unfinished phrase", out.length === 0 && rest.length === 1 && secs(rest[0]) > 1.4]);
}

// Шумная комната: порог подстраивается
{
  const noisy = (ms: number) => Float32Array.from({ length: Math.round((ms / 1000) * SR) }, () => (Math.random() - 0.5) * 0.04);
  const s = new Segmenter({ sampleRate: SR });
  const out = [...feed(s, concat(noisy(8000), tone(1500, 0.3), noisy(1500))), ...s.flush()];
  t.push(["noise floor adapts: speech still found in a noisy room", out.length >= 1 && out.length <= 2]);
}

// Int16
{
  const i16 = toInt16(Float32Array.of(0, 1, -1, 2, -2, 0.5));
  t.push(["toInt16 clamps and scales", i16[1] === 32767 && i16[2] === -32768 && i16[3] === 32767 && i16[4] === -32768 && Math.abs(i16[5] - 16384) <= 1]);
}

let n = 0;
for (const [name, ok] of t) if (!ok) { n++; console.error("FAIL", name); }
console.log(n ? `BAD segmenter (${n})` : `ok segmenter (${t.length})`);
process.exit(n ? 1 : 0);
