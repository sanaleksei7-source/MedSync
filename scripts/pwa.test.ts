// Проверка файлов установки: манифест, значки, service worker не трогает данные.
import { existsSync, readFileSync } from "node:fs";

const t: [string, boolean][] = [];
const read = (p: string) => readFileSync(p, "utf-8");
const manifest = JSON.parse(read("public/manifest.webmanifest"));
const html = read("index.html");
const sw = read("public/sw.js").replace(/^\s*\/\/.*$/gm, ""); // комментарии не проверяем, только код

t.push(["manifest basics", manifest.display === "standalone" && manifest.start_url === "/" && manifest.lang === "ru" && !!manifest.name && !!manifest.short_name]);
t.push(["manifest is marked demo, not a medical product", /демо/i.test(manifest.name)]);

const pngSize = (p: string) => {
  const b = readFileSync(p);
  const sig = b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return sig ? [b.readUInt32BE(16), b.readUInt32BE(20)] : [0, 0];
};
const icons = manifest.icons as { src: string; sizes: string; purpose: string }[];
t.push(["has 192 and 512 icons and a maskable one", icons.some((i) => i.sizes === "192x192") && icons.some((i) => i.sizes === "512x512" && i.purpose === "any") && icons.some((i) => i.purpose === "maskable")]);
t.push(["icon files exist and match declared size", icons.every((i) => {
  const f = "public" + i.src;
  if (!existsSync(f)) return false;
  const [w, h] = pngSize(f);
  return `${w}x${h}` === i.sizes;
})]);
t.push(["apple touch icon is 180x180", pngSize("public/icons/apple-touch-icon.png").join("x") === "180x180"]);
t.push(["index.html links manifest, apple icon, theme color", html.includes('rel="manifest"') && html.includes("apple-touch-icon") && html.includes('name="theme-color"')]);

// service worker: никакого кэширования данных
t.push(["sw never stores responses", !/cache\.put|addAll|cache\.add\(.*req|\.put\(/i.test(sw.replace(/c\.add\(OFFLINE_URL\)/, ""))]);
t.push(["sw only handles page navigations", /req\.mode !== "navigate"\) return/.test(sw)]);
t.push(["sw does not mention the API", !sw.includes("/api")]);
t.push(["offline page exists and says nothing is stored", existsSync("public/offline.html") && /не хранятся/.test(read("public/offline.html"))]);
t.push(["main.tsx registers sw only in production over a secure context", /import\.meta\.env\.PROD/.test(read("src/main.tsx")) && /isSecureContext/.test(read("src/main.tsx"))]);

let bad = 0;
for (const [n, ok] of t) if (!ok) { bad++; console.error("FAIL", n); }
console.log(bad ? `BAD pwa (${bad})` : `ok pwa (${t.length})`);
if (bad) process.exitCode = 1;
