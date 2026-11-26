// Переводит записи с телефона (m4a/mp4/mp3/ogg/wav...) в WAV 16 кГц моно средствами браузера, без ffmpeg.
//   npx tsx scripts/convert-recordings.ts <папка с записями> <папка для WAV>
// Затем откройте http://127.0.0.1:8899 в браузере: страница сама декодирует и сохранит файлы.
// Сервер слушает только 127.0.0.1, читает только указанную папку и пишет только в папку для WAV.
import http from "node:http";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
  console.error("Использование: npx tsx scripts/convert-recordings.ts <записи> <папка для wav>");
  process.exit(1);
}
mkdirSync(dst, { recursive: true });

const AUDIO = /\.(m4a|mp4|mp3|aac|ogg|oga|opus|wav|flac|webm|3gp|amr)$/i;
const files = readdirSync(src).filter((f) => AUDIO.test(f)).sort();

/** "Take 03.m4a.mp4" → "take03", "silence-quiet.mp3" → "silence-quiet". */
export function normalizeName(file: string): string {
  let base = file;
  for (let i = 0; i < 3; i++) base = base.replace(AUDIO, "");
  base = base.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9-]/g, "");
  return base.replace(/^take(\d)(?!\d)/, "take0$1");
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>Конвертация записей</title>
<body style="font:15px system-ui;margin:24px"><h1>Конвертация записей в WAV 16 кГц</h1><pre id="log">запуск…</pre>
<script>
const log = (s) => { document.getElementById("log").textContent += "\\n" + s; };
function wav(samples) {
  const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const x = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true); }
  return buf;
}
(async () => {
  const list = await (await fetch("/list")).json();
  const ctx = new AudioContext();
  let ok = 0, bad = 0;
  for (const [i, item] of list.entries()) {
    try {
      const bytes = await (await fetch("/file/" + i)).arrayBuffer();
      const decoded = await ctx.decodeAudioData(bytes);
      const frames = Math.ceil(decoded.duration * 16000);
      const off = new OfflineAudioContext(1, frames, 16000);
      const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
      const rendered = await off.startRendering();
      const r = await fetch("/wav/" + item.out, { method: "POST", body: wav(rendered.getChannelData(0)) });
      if (!r.ok) throw new Error("save failed " + r.status);
      ok++; log("ok  " + item.name + " → " + item.out + ".wav  (" + decoded.duration.toFixed(1) + " с, исходно " + decoded.sampleRate + " Гц, каналов " + decoded.numberOfChannels + ")");
    } catch (e) { bad++; log("ОШИБКА " + item.name + ": " + e); }
  }
  log("\\nГОТОВО: успешно " + ok + ", ошибок " + bad);
})();
</script>`;

const server = http.createServer((req, res) => {
  const url = req.url ?? "";
  if (req.method === "GET" && url === "/") return void res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE);
  if (req.method === "GET" && url === "/list") {
    return void res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(files.map((f) => ({ name: f, out: normalizeName(f) }))));
  }
  const get = /^\/file\/(\d+)$/.exec(url);
  if (req.method === "GET" && get && files[+get[1]]) {
    return void res.writeHead(200, { "Content-Type": "application/octet-stream" }).end(readFileSync(join(src, files[+get[1]])));
  }
  const post = /^\/wav\/([a-z0-9-]+)$/.exec(url);
  if (req.method === "POST" && post) {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => { size += c.length; if (size <= 60_000_000) chunks.push(c); });
    req.on("end", () => {
      if (size > 60_000_000) return void res.writeHead(413).end();
      writeFileSync(join(dst, post[1] + ".wav"), Buffer.concat(chunks));
      res.writeHead(200).end("ok");
    });
    return;
  }
  res.writeHead(404).end();
});
server.listen(8899, "127.0.0.1", () => console.log(`Откройте http://127.0.0.1:8899 (файлов: ${files.length})`));
