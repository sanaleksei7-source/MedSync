// Копирование текста разговора. На общем ноутбуке скопированный текст остаётся в буфере обмена, поэтому при выходе его затираем.
let copied = false;

export function copyText(text: string) {
  copied = true;
  return navigator.clipboard?.writeText(text);
}

/** Лучшее, что можно сделать: браузер разрешает запись в буфер только странице в фокусе или после действия пользователя. */
export function clearCopiedText() {
  if (!copied) return;
  copied = false;
  try {
    void navigator.clipboard?.writeText("").catch(() => {});
  } catch {
    /* буфер недоступен — ничего не поделать */
  }
}
