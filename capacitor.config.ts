import type { CapacitorConfig } from "@capacitor/cli";

// Мобильное приложение (шаг 4.1): тот же код, что и сайт, внутри оболочки Capacitor.
// Страница открывается с https://localhost внутри телефона; сервер задаётся при сборке (VITE_API_BASE, scripts/android.ts).
const config: CapacitorConfig = {
  appId: "kg.medsync.app", // постоянный идентификатор в магазинах; менять только до первой публикации
  appName: "MedSync",
  webDir: "dist",
  android: {
    allowMixedContent: false, // никаких http-запросов из https-страницы
    webContentsDebuggingEnabled: false, // в рабочих сборках отладка страницы выключена (в отладочной сборке Android включает её сам)
  },
};

export default config;
