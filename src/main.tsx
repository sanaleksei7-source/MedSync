import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { NATIVE } from "./api";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Установка на главный экран. Только в собранной версии и только на защищённом соединении (HTTPS или localhost).
// В приложении (Capacitor) worker не нужен: файлы и так лежат в самом приложении.
if (import.meta.env.PROD && !NATIVE && "serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* без worker'а приложение работает как обычно, просто без установки */
    });
  });
}
