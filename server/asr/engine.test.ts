import http from "node:http";
import type { AddressInfo } from "node:net";
import { HttpWhisperEngine, MockEngine, SAMPLE_RATE, assertAllowedAsrUrl, engineFromEnv, isHallucination, pcmToWav, rms, wavToPcm } from "./engine";

const t: [string, boolean][] = [];
const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };

// WAV туда и обратно
const pcm = Int16Array.from({ length: 1600 }, (_, i) => Math.round(Math.sin(i / 10) * 8000));
const wav = pcmToWav(pcm);
t.push(["wav header", wav.toString("ascii", 0, 4) === "RIFF" && wav.readUInt32LE(24) === SAMPLE_RATE && wav.length === 44 + 3200]);
t.push(["wav roundtrip", wavToPcm(wav).every((v, i) => v === pcm[i]) && wavToPcm(wav).length === pcm.length]);
const stereo = Buffer.from(wav); stereo.writeUInt16LE(2, 22);
t.push(["stereo wav rejected", throws(() => wavToPcm(stereo))]);
const wrongRate = Buffer.from(wav); wrongRate.writeUInt32LE(44100, 24);
t.push(["44.1 kHz wav rejected", throws(() => wavToPcm(wrongRate))]);
t.push(["garbage rejected", throws(() => wavToPcm(Buffer.from("not a wav file at all, definitely not")))]);

t.push(["rms of silence is 0", rms(new Int16Array(100)) === 0]);
t.push(["rms of loud signal", rms(pcm) > 4000]);

// Политика адреса: аудио не должно уходить за пределы клиники
t.push(["localhost http ok", !throws(() => assertAllowedAsrUrl("http://127.0.0.1:8080"))]);
t.push(["localhost name ok", !throws(() => assertAllowedAsrUrl("http://localhost:8080"))]);
t.push(["ipv6 loopback ok", !throws(() => assertAllowedAsrUrl("http://[::1]:8080"))]);
t.push(["LAN http rejected", throws(() => assertAllowedAsrUrl("http://192.168.1.20:8080"))]);
t.push(["LAN https ok", !throws(() => assertAllowedAsrUrl("https://192.168.1.20:8443"))]);
t.push(["10.x https ok", !throws(() => assertAllowedAsrUrl("https://10.0.0.5"))]);
t.push(["public host rejected", throws(() => assertAllowedAsrUrl("https://api.example.com"))]);
t.push(["public https needs explicit allow", !throws(() => assertAllowedAsrUrl("https://api.example.com", true))]);
t.push(["public http rejected even if allowed", throws(() => assertAllowedAsrUrl("http://api.example.com", true))]);
t.push(["trick hostname rejected", throws(() => assertAllowedAsrUrl("http://127.0.0.1.evil.example"))]);
t.push(["172.32 is public", throws(() => assertAllowedAsrUrl("https://172.32.0.1"))]);

// Галлюцинации
t.push(["hallucination caught", isHallucination("Продолжение следует...") && isHallucination("Субтитры сделал DimaTorzok") && isHallucination("Спасибо за просмотр!")]);
t.push(["real text kept", !isHallucination("Температура тридцать семь и восемь.") && !isHallucination("")]);

// Движки
const m = new MockEngine();
t.push(["mock labelled", (await m.transcribe(pcm)).startsWith("[тестовое распознавание")]);
t.push(["no engine by default", engineFromEnv({}) === null]);
t.push(["mock via env", engineFromEnv({ ASR_ENGINE: "mock" })?.name === "mock"]);
t.push(["unsafe env url throws", throws(() => engineFromEnv({ ASR_URL: "https://api.example.com" }))]);

// HTTP-движок против поддельного сервиса whisper.cpp
let received: { path?: string; type?: string; body?: Buffer } = {};
const fake = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    received = { path: req.url, type: req.headers["content-type"], body: Buffer.concat(chunks) };
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ text: "  Температура тридцать семь и восемь.  " }));
  });
});
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
const port = (fake.address() as AddressInfo).port;
const eng = new HttpWhisperEngine(`http://127.0.0.1:${port}`);
const text = await eng.transcribe(pcm);
const bodyStr = received.body?.toString("latin1") ?? "";
t.push(["http engine returns trimmed text", text === "Температура тридцать семь и восемь."]);
t.push(["http engine posts to /inference as multipart", received.path === "/inference" && /multipart\/form-data/.test(received.type ?? "")]);
t.push(["request carries a WAV and language=ru", bodyStr.includes("RIFF") && bodyStr.includes('name="language"') && bodyStr.includes("ru")]);
fake.close();
const bad = http.createServer((_q, res) => { res.statusCode = 500; res.end("boom"); });
await new Promise<void>((r) => bad.listen(0, "127.0.0.1", r));
const badEng = new HttpWhisperEngine(`http://127.0.0.1:${(bad.address() as AddressInfo).port}`);
t.push(["http error surfaces as error", await badEng.transcribe(pcm).then(() => false, () => true)]);
bad.close();

let n = 0;
for (const [name, ok] of t) if (!ok) { n++; console.error("FAIL", name); }
console.log(n ? `BAD asr-engine (${n})` : `ok asr-engine (${t.length})`);
process.exit(n ? 1 : 0);
