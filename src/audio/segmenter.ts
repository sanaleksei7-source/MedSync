// Делит поток звука на фразы по паузам, чтобы на распознавание уходили короткие сегменты, а тишина не уходила совсем.
// Чистая логика без браузерных API, поэтому проверяется тестом.

export interface SegmenterOptions {
  sampleRate: number;
  preRollMs: number; // сколько звука до начала речи сохранять, чтобы не обрезать первый слог
  hangoverMs: number; // пауза, после которой фраза считается законченной
  maxMs: number; // жёсткий предел длины сегмента
  minMs: number; // если громкой речи в сегменте меньше, он отбрасывается (щелчки, стук); паузы и разгон не считаются
  minThreshold: number; // нижняя граница порога громкости (RMS, шкала −1…1)
  noiseFactor: number; // порог = max(minThreshold, шум × noiseFactor)
}

export const DEFAULTS: Omit<SegmenterOptions, "sampleRate"> = {
  preRollMs: 300,
  hangoverMs: 700,
  maxMs: 25_000,
  minMs: 400,
  minThreshold: 0.008,
  noiseFactor: 3,
};

const rmsOf = (f: Float32Array) => {
  let s = 0;
  for (let i = 0; i < f.length; i++) s += f[i] * f[i];
  return Math.sqrt(s / Math.max(1, f.length));
};

export class Segmenter {
  private o: SegmenterOptions;
  private preRoll: Float32Array[] = [];
  private preRollLen = 0;
  private current: Float32Array[] = [];
  private currentLen = 0;
  private silentLen = 0;
  private voicedLen = 0;
  private noise = 0.002; // оценка фонового шума, обновляется в паузах
  private inSpeech = false;

  constructor(opts: Partial<SegmenterOptions> & { sampleRate: number }) {
    this.o = { ...DEFAULTS, ...opts };
  }

  private ms = (samples: number) => (samples / this.o.sampleRate) * 1000;
  get threshold() { return Math.max(this.o.minThreshold, this.noise * this.o.noiseFactor); }
  get speaking() { return this.inSpeech; }

  /** Принимает блок звука, возвращает законченные сегменты (обычно 0 или 1). */
  push(frame: Float32Array): Float32Array[] {
    const out: Float32Array[] = [];
    const level = rmsOf(frame);
    const loud = level > this.threshold;

    if (!this.inSpeech) {
      if (loud) {
        this.inSpeech = true;
        this.current = [...this.preRoll, frame];
        this.currentLen = this.preRollLen + frame.length;
        this.silentLen = 0;
        this.voicedLen = frame.length;
        this.preRoll = [];
        this.preRollLen = 0;
      } else {
        this.noise = this.noise * 0.98 + level * 0.02; // подстраиваемся под шум комнаты
        this.preRoll.push(frame);
        this.preRollLen += frame.length;
        while (this.preRoll.length > 1 && this.ms(this.preRollLen - this.preRoll[0].length) >= this.o.preRollMs) {
          this.preRollLen -= this.preRoll.shift()!.length;
        }
      }
      return out;
    }

    this.current.push(frame);
    this.currentLen += frame.length;
    this.silentLen = loud ? 0 : this.silentLen + frame.length;
    if (loud) this.voicedLen += frame.length;
    if (this.ms(this.silentLen) >= this.o.hangoverMs || this.ms(this.currentLen) >= this.o.maxMs) {
      const seg = this.finish();
      if (seg) out.push(seg);
    }
    return out;
  }

  /** Вызывается при остановке записи: отдаёт недосказанную фразу. */
  flush(): Float32Array[] {
    const seg = this.inSpeech ? this.finish() : null;
    return seg ? [seg] : [];
  }

  private finish(): Float32Array | null {
    const total = this.currentLen;
    const seg = new Float32Array(total);
    let pos = 0;
    for (const f of this.current) { seg.set(f, pos); pos += f.length; }
    this.current = [];
    this.currentLen = 0;
    this.silentLen = 0;
    this.inSpeech = false;
    const voiced = this.voicedLen;
    this.voicedLen = 0;
    return this.ms(voiced) >= this.o.minMs ? seg : null;
  }
}

/** Float32 (−1…1) → Int16 little-endian для отправки на сервер. */
export function toInt16(f: Float32Array): Int16Array {
  const out = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) {
    const v = Math.max(-1, Math.min(1, f[i]));
    out[i] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
  }
  return out;
}
