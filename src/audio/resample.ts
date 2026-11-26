/**
 * Потоковый ресэмплер (оконный sinc с фильтром против наложения частот).
 * Нужен для iPhone: Safari игнорирует просьбу открыть микрофон на 16 кГц и отдаёт 44,1 или 48 кГц,
 * а распознавание речи ждёт ровно 16 кГц. Блоки можно подавать любого размера: результат не зависит от нарезки.
 */
const ZERO_CROSSINGS = 8;

export class Resampler {
  private readonly step: number; // шаг по входным отсчётам на один выходной
  private readonly cutoff: number; // относительно частоты Найквиста входа
  private readonly half: number; // полуширина ядра, во входных отсчётах
  private buf: Float32Array;
  private pos: number; // положение следующего выходного отсчёта во входном буфере

  constructor(inRate: number, outRate: number) {
    if (!(inRate > 0) || !(outRate > 0) || !Number.isFinite(inRate) || !Number.isFinite(outRate)) throw new Error("bad sample rate");
    this.step = inRate / outRate;
    this.cutoff = Math.min(1, 1 / this.step);
    this.half = Math.ceil(ZERO_CROSSINGS / this.cutoff);
    this.buf = new Float32Array(this.half); // нули слева: поток начинается с тишины
    this.pos = this.half;
  }

  push(input: Float32Array): Float32Array {
    const merged = new Float32Array(this.buf.length + input.length);
    merged.set(this.buf);
    merged.set(input, this.buf.length);
    this.buf = merged;

    const out: number[] = [];
    const c = this.cutoff;
    while (Math.floor(this.pos) + this.half < this.buf.length) {
      const centre = this.pos;
      const from = Math.ceil(centre - this.half);
      const to = Math.floor(centre + this.half);
      let acc = 0;
      let norm = 0;
      for (let i = from; i <= to; i++) {
        const x = i - centre;
        const arg = Math.PI * c * x;
        const sinc = x === 0 ? 1 : Math.sin(arg) / arg;
        const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / (this.half + 1)); // окно Ханна
        const k = sinc * w;
        acc += this.buf[i] * k;
        norm += k;
      }
      out.push(acc / norm); // нормировка сохраняет уровень сигнала
      this.pos += this.step;
    }
    // Отбрасываем то, что больше не понадобится.
    const keepFrom = Math.max(0, Math.floor(this.pos) - this.half);
    if (keepFrom > 0) {
      this.buf = this.buf.slice(keepFrom);
      this.pos -= keepFrom;
    }
    return Float32Array.from(out);
  }
}
