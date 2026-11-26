// Запуск для проверки на телефоне в той же Wi-Fi сети: npm run dev:lan  (обычный режим)  или  npm run dev:lan -- --build  (собранная версия: нужна для установки на главный экран)
//  1. создаёт локальный сертификат (один раз) в папке ВНЕ проекта: C:\Users\<вы>\medsync-dev-certs;
//  2. запускает сервер и сайт по HTTPS на адресе компьютера в локальной сети.
// Браузеру телефона нужен HTTPS, иначе он не даст доступ к микрофону.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { networkInterfaces, homedir } from "node:os";
import { join } from "node:path";
import { isPrivateIpv4, pickLanIp } from "./lan";

const DIR = process.env.DEV_CERT_DIR ?? join(homedir(), "medsync-dev-certs");
const PORT = 5173;
const built = process.argv.includes("--build"); // собранная версия, как на настоящем сервере; работает service worker и установка на экран

function openssl(args: string[]) {
  const candidates = [process.env.OPENSSL, "openssl", "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe", "C:\\Program Files\\Git\\usr\\bin\\openssl.exe"].filter(Boolean) as string[];
  let last: unknown;
  for (const bin of candidates) {
    try { return execFileSync(bin, args, { cwd: DIR, stdio: ["ignore", "pipe", "pipe"] }).toString(); } catch (e) {
      last = e;
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  throw new Error(`Не найден openssl (ставится вместе с Git for Windows). ${String(last)}`);
}

const ip = process.env.DEV_LAN_IP ?? pickLanIp(networkInterfaces());
if (!ip || !isPrivateIpv4(ip)) {
  console.error("Не нашёл адрес компьютера в локальной сети (192.168.x.x, 10.x.x.x). Подключитесь к Wi-Fi или задайте DEV_LAN_IP.");
  process.exit(1);
}

mkdirSync(DIR, { recursive: true });

// Корневой сертификат: ограничен частными сетями и localhost, поэтому даже при утечке ключа
// им нельзя подписать сертификат для настоящего сайта в интернете.
if (!existsSync(join(DIR, "ca.key")) || !existsSync(join(DIR, "rootCA.crt"))) {
  writeFileSync(join(DIR, "ca.cnf"), [
    "[req]", "distinguished_name=dn", "x509_extensions=v3_ca", "prompt=no",
    "[dn]", "CN=MedSync local dev CA",
    "[v3_ca]", "basicConstraints=critical,CA:TRUE,pathlen:0", "keyUsage=critical,keyCertSign,cRLSign", "subjectKeyIdentifier=hash", "nameConstraints=critical,@nc",
    "[nc]",
    "permitted;IP.0=192.168.0.0/255.255.0.0", "permitted;IP.1=10.0.0.0/255.0.0.0", "permitted;IP.2=172.16.0.0/255.240.0.0", "permitted;IP.3=127.0.0.0/255.0.0.0", "permitted;DNS.0=localhost",
  ].join("\n"));
  openssl(["ecparam", "-genkey", "-name", "prime256v1", "-noout", "-out", "ca.key"]);
  openssl(["req", "-x509", "-new", "-key", "ca.key", "-sha256", "-days", "730", "-config", "ca.cnf", "-out", "rootCA.crt"]);
  openssl(["x509", "-in", "rootCA.crt", "-outform", "DER", "-out", "rootCA.cer"]);
  console.log("Создан корневой сертификат:", join(DIR, "rootCA.crt"));
}

// Сертификат сайта: заново, если сменился адрес или остался меньше недели.
const sanOk = () => {
  try {
    if (!existsSync(join(DIR, "server.crt"))) return false;
    if (!openssl(["x509", "-in", "server.crt", "-noout", "-ext", "subjectAltName"]).includes(`IP Address:${ip}`)) return false;
    openssl(["x509", "-in", "server.crt", "-noout", "-checkend", String(7 * 86400)]);
    return true;
  } catch { return false; }
};
if (!sanOk()) {
  writeFileSync(join(DIR, "server.ext"), [
    "basicConstraints=CA:FALSE", "keyUsage=critical,digitalSignature", "extendedKeyUsage=serverAuth", `subjectAltName=IP:${ip},IP:127.0.0.1,DNS:localhost`,
  ].join("\n"));
  openssl(["ecparam", "-genkey", "-name", "prime256v1", "-noout", "-out", "server.key"]);
  openssl(["req", "-new", "-key", "server.key", "-subj", "/CN=MedSync dev", "-out", "server.csr"]);
  openssl(["x509", "-req", "-in", "server.csr", "-CA", "rootCA.crt", "-CAkey", "ca.key", "-CAcreateserial", "-days", "365", "-sha256", "-extfile", "server.ext", "-out", "server.crt"]);
  console.log(`Выпущен сертификат сайта для ${ip}`);
}

const origin = `https://${ip}:${PORT}`;
console.log(`
Готово. Телефон должен быть в той же Wi-Fi сети, что и компьютер.
  1. Один раз установите на телефон корневой сертификат: ${join(DIR, "rootCA.crt")}
     (отправьте файл себе и откройте на телефоне; инструкция — docs/PHONE_TEST.md)
  2. Откройте на телефоне: ${origin}
Остановить: Ctrl+C. Windows может спросить разрешение для сети — разрешите только для «Частной сети».
`);

const run = (cmd: string, args: string[], env: Record<string, string>) =>
  spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } });

const api = run("npx", ["tsx", "server/index.ts"], { ALLOWED_ORIGINS: `${origin},https://localhost:${PORT}` });
if (built) {
  console.log("Собираю приложение…");
  execFileSync("npx", ["vite", "build"], { stdio: "inherit", shell: process.platform === "win32" });
}
const web = run("npx", ["vite", ...(built ? ["preview"] : []), "--host", "0.0.0.0", "--port", String(PORT), "--strictPort"], {
  DEV_HTTPS: "1", DEV_LAN_IP: ip, DEV_CERT_DIR: DIR,
});
const stop = () => { api.kill(); web.kill(); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
web.on("exit", (code) => { api.kill(); process.exit(code ?? 0); });
