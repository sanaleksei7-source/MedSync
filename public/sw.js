// Service worker нужен только для установки на главный экран и страницы «нет связи».
// Намеренно НЕ кэширует ни запросы к API, ни страницы приложения, ни ответы сервера: данные пациентов
// не должны оставаться в кэше телефона, а устаревший код после обновления опаснее его отсутствия.
const CACHE = "medsync-offline-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Только переходы по страницам и только если сети нет. Всё остальное (включая /api) идёт напрямую, мимо worker'а.
  if (req.mode !== "navigate") return;
  event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
});
