// Сборка приложения Android (шаг 4.1): npm run android -- [--api https://192.168.1.5:5173] [--install]
//
//  1. собирает сайт для приложения: адрес сервера (VITE_API_BASE) вшивается в сборку и в CSP;
//  2. переносит его в проект Android (npx cap sync android);
//  3. собирает отладочный APK (gradlew assembleDebug);
//  4. с --install ставит его на телефон, подключённый по USB (adb install -r).
//
// Инструменты берутся из папки ANDROID_DEV_DIR (по умолчанию C:\Users\<вы>\android-dev: jdk-21…, sdk), если JAVA_HOME
// и ANDROID_HOME не заданы. Отладочная сборка доверяет локальному сертификату разработки (npm run dev:lan) — см.
// android/app/src/debug/res/xml/network_security_config.xml. Рабочая (release) сборка ему не доверяет.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { isPrivateIpv4, pickLanIp } from "./lan";

const args = process.argv.slice(2);
const arg = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const win = process.platform === "win32";

const devDir = process.env.ANDROID_DEV_DIR ?? join(homedir(), "android-dev");
const javaHome = process.env.JAVA_HOME ?? (existsSync(devDir) ? readdirSync(devDir).filter((d) => d.startsWith("jdk-")).sort().map((d) => join(devDir, d)).pop() : undefined);
const sdk = process.env.ANDROID_HOME ?? join(devDir, "sdk");
if (!javaHome || !existsSync(join(javaHome, "bin"))) throw new Error(`Не найден JDK. Задайте JAVA_HOME или положите jdk-21 в ${devDir} (docs/ANDROID.md).`);
if (!existsSync(join(sdk, "platform-tools"))) throw new Error(`Не найден Android SDK в ${sdk}. Задайте ANDROID_HOME (docs/ANDROID.md).`);

const ip = process.env.DEV_LAN_IP ?? pickLanIp(networkInterfaces());
const api = arg("--api") ?? (ip && isPrivateIpv4(ip) ? `https://${ip}:5173` : undefined);
if (!api || !api.startsWith("https://")) throw new Error("Укажите адрес сервера: --api https://<адрес>:5173 (только https)");

const env = { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk, VITE_API_BASE: api, PATH: `${join(javaHome, "bin")}${win ? ";" : ":"}${process.env.PATH}` };
const run = (cmd: string, a: string[], cwd = process.cwd()) => execFileSync(cmd, a, { stdio: "inherit", cwd, env, shell: win });

// Локальный сертификат для отладочной сборки, чтобы приложение доверяло серверу разработки по https.
const certDir = process.env.DEV_CERT_DIR ?? join(homedir(), "medsync-dev-certs");
const ca = join(certDir, "rootCA.crt");
if (!existsSync(ca)) throw new Error(`Нет ${ca}. Один раз запустите npm run dev:lan — он создаст сертификат разработки.`);
const raw = join("android", "app", "src", "debug", "res", "raw");
mkdirSync(raw, { recursive: true });
copyFileSync(ca, join(raw, "medsync_dev_ca.crt"));
writeFileSync(join("android", "local.properties"), `sdk.dir=${sdk.replace(/\\/g, "\\\\").replace(/:/g, "\\:")}\n`);

console.log(`Сервер для приложения: ${api}`);
run("npx", ["vite", "build"]);
run("npx", ["cap", "sync", "android"]);
run(win ? "gradlew.bat" : "./gradlew", ["assembleDebug", "--no-daemon"], join(process.cwd(), "android"));
const apk = join("android", "app", "build", "outputs", "apk", "debug", "app-debug.apk");
console.log(`Готово: ${apk}`);

if (args.includes("--install")) {
  const adb = join(sdk, "platform-tools", win ? "adb.exe" : "adb");
  run(adb, ["install", "-r", apk]);
  console.log("Установлено. Откройте MedSync на телефоне. Сервер должен быть запущен: npm run dev:lan");
}
