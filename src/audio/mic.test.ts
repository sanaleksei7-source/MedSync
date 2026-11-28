import { LevelMeter, describeMicError, pickInputs } from "./mic";

let bad = 0;
const check = (name: string, ok: boolean) => {
  console.log(ok ? "ok " : "BAD", name);
  if (!ok) bad++;
};
const err = (name: string) => Object.assign(new Error("x"), { name });

check("permission denied points to the site icon and Windows privacy settings", /разрешите микрофон/.test(describeMicError(err("NotAllowedError"))) && /Конфиденциальность/.test(describeMicError(err("NotAllowedError"))));
check("old Chrome name for denied works too", describeMicError(err("PermissionDeniedError")) === describeMicError(err("NotAllowedError")));
check("no device", /не найден/.test(describeMicError(err("NotFoundError"))));
check("busy device names the usual culprits", /Teams|Zoom/.test(describeMicError(err("NotReadableError"))));
check("chosen device gone", /Выбранный микрофон/.test(describeMicError(err("OverconstrainedError"))));
check("insecure page", /защищённый адрес/.test(describeMicError(err("SecurityError"))));
check("own error text is kept", describeMicError(new Error("Браузер не поддерживает захват звука.")) === "Браузер не поддерживает захват звука.");
check("unknown value gets a generic message", describeMicError(undefined) === "Не удалось включить микрофон.");

const list = pickInputs([
  { kind: "audioinput", deviceId: "default", label: "Default - Microphone (Realtek)" },
  { kind: "audioinput", deviceId: "communications", label: "Communications - Microphone (Realtek)" },
  { kind: "audioinput", deviceId: "a1", label: "Microphone (Realtek)" },
  { kind: "audioinput", deviceId: "b2", label: "Headset (USB)" },
  { kind: "videoinput", deviceId: "v1", label: "Camera" },
  { kind: "audiooutput", deviceId: "o1", label: "Speakers" },
]);
check("only real microphones are listed (no default/communications copies, no camera or speakers)", list.length === 2 && list[0].id === "a1" && list[1].id === "b2");
const unlabeled = pickInputs([
  { kind: "audioinput", deviceId: "x", label: "" },
  { kind: "audioinput", deviceId: "y", label: "  " },
]);
check("before permission, devices without names are numbered", unlabeled[0].label === "Микрофон 1" && unlabeled[1].label === "Микрофон 2");
check("no devices gives an empty list", pickInputs([]).length === 0);

const m = new LevelMeter(0);
check("meter starts at zero", m.value === 0);
m.push(new Float32Array(160).fill(0.05), 1_000);
check("speech-level sound moves the meter", m.value > 0.2 && m.value <= 1);
check("loud sound is capped at 1", (() => { const x = new LevelMeter(0); x.push(new Float32Array(160).fill(0.9), 1); return x.value === 1; })());
const before = m.value;
for (let i = 0; i < 30; i++) m.push(new Float32Array(160), 1_000 + i * 10);
check("the meter falls back when sound stops", m.value < before / 4);
check("silence is measured from the last sound", m.silentFor(9_000) === 8_000);
m.push(new Float32Array(160).fill(0.05), 9_500);
check("sound resets the silence timer", m.silentFor(9_600) === 100);
m.push(new Float32Array(0), 20_000);
check("an empty block changes nothing", m.silentFor(20_000) === 10_500);
check("very quiet noise below the floor counts as silence", (() => { const x = new LevelMeter(0); x.push(new Float32Array(160).fill(0.001), 5_000); return x.silentFor(5_000) === 5_000; })());

if (bad) process.exit(1);
