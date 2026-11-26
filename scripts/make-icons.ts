// Рисует значки приложения (бирюзовый фон, белый крест) в public/icons/. Запуск: npx tsx scripts/make-icons.ts
// Зависимостей нет: PNG собирается вручную. Готовые файлы лежат в репозитории, скрипт нужен только чтобы их перерисовать.
import { deflateSync, crc32 } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const TEAL = [0x0f, 0x76, 0x6e];
const WHITE = [255, 255, 255];

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

export function png(size: number, opts: { rounded: boolean; crossScale: number }): Buffer {
  const SS = 4; // сглаживание: 4×4 точки на пиксель
  const radius = opts.rounded ? size * 0.22 : 0;
  const arm = size * opts.crossScale; // длина перекладины
  const thick = arm * 0.32;
  const c = size / 2;
  const inCross = (x: number, y: number) =>
    (Math.abs(x - c) <= thick / 2 && Math.abs(y - c) <= arm / 2) || (Math.abs(y - c) <= thick / 2 && Math.abs(x - c) <= arm / 2);
  const inShape = (x: number, y: number) => {
    if (!radius) return true;
    const dx = Math.max(radius - x, 0, x - (size - radius));
    const dy = Math.max(radius - y, 0, y - (size - radius));
    return dx * dx + dy * dy <= radius * radius;
  };
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // фильтр строки: без фильтра
    for (let x = 0; x < size; x++) {
      let a = 0, cross = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
          if (!inShape(px, py)) continue;
          a++;
          if (inCross(px, py)) cross++;
        }
      const n = SS * SS;
      const k = a ? cross / a : 0;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(TEAL[i] * (1 - k) + WHITE[i] * k);
      raw[o + 3] = Math.round((255 * a) / n);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 бит, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

if (process.argv[1]?.endsWith("make-icons.ts")) {
  mkdirSync("public/icons", { recursive: true });
  const files: [string, number, { rounded: boolean; crossScale: number }][] = [
    ["icon-192.png", 192, { rounded: true, crossScale: 0.55 }],
    ["icon-512.png", 512, { rounded: true, crossScale: 0.55 }],
    // maskable: фон до самых краёв, рисунок внутри «безопасной зоны» (80 %), система сама обрежет форму
    ["icon-maskable-512.png", 512, { rounded: false, crossScale: 0.42 }],
    // iPhone сам скругляет углы и не любит прозрачность
    ["apple-touch-icon.png", 180, { rounded: false, crossScale: 0.5 }],
  ];
  for (const [name, size, o] of files) writeFileSync(`public/icons/${name}`, png(size, o));
  console.log("Значки записаны в public/icons/");
}
