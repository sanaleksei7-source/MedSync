// Микрофон на ноутбуке: понятные сообщения об ошибках, список устройств и шкала уровня звука.
// Всё здесь — чистая логика без браузера, её проверяют тестом.

export interface MicInput {
  id: string;
  label: string;
}

/** Что сказать врачу, если микрофон не включился. Имена ошибок — из спецификации getUserMedia (и старые имена Chrome). */
export function describeMicError(e: unknown): string {
  const name = e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Нет доступа к микрофону. Нажмите на значок слева от адреса сайта и разрешите микрофон. Если не помогло, проверьте параметры Windows: Конфиденциальность → Микрофон.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "Микрофон не найден. Подключите микрофон или гарнитуру и нажмите «Обновить список».";
    case "NotReadableError":
    case "TrackStartError":
      return "Микрофон занят или не отвечает: возможно, его использует другое приложение (Teams, Zoom, Skype). Закройте его и попробуйте снова.";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "Выбранный микрофон сейчас недоступен. Выберите другой из списка.";
    case "SecurityError":
      return "Браузер не разрешает микрофон на этой странице: нужен защищённый адрес (https или localhost).";
    case "AbortError":
      return "Запуск микрофона прервался. Попробуйте ещё раз.";
    default:
      return e instanceof Error && e.message ? e.message : "Не удалось включить микрофон.";
  }
}

/**
 * Список входов для выбора. Windows в Chrome и Edge показывает ещё «По умолчанию» и «Связь» — дубли настоящих устройств;
 * «Связь» убираем, «По умолчанию» заменяет строка «Системный по умолчанию» в самой странице. До разрешения на микрофон
 * браузер не отдаёт названия — тогда нумеруем.
 */
export function pickInputs(devices: { kind: string; deviceId: string; label: string }[]): MicInput[] {
  const out: MicInput[] = [];
  let n = 0;
  for (const d of devices) {
    if (d.kind !== "audioinput" || d.deviceId === "communications" || d.deviceId === "default") continue;
    n++;
    out.push({ id: d.deviceId, label: d.label.trim() || `Микрофон ${n}` });
  }
  return out;
}

/** Уровень звука по блокам из микрофона и «тишина дольше N секунд» (выключенная гарнитура, не тот микрофон). */
export class LevelMeter {
  private smooth = 0;
  private lastSound: number;
  /** floor — громкость (среднеквадратичная, 0–1), ниже которой считаем тишиной. */
  constructor(now: number, private floor = 0.004) {
    this.lastSound = now;
  }

  push(frame: Float32Array, now: number) {
    if (!frame.length) return;
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    this.smooth = Math.max(rms, this.smooth * 0.9);
    if (rms > this.floor) this.lastSound = now;
  }

  /** Для шкалы на экране: 0–1, речь обычно даёт 0,02–0,15, поэтому усиливаем. */
  get value() {
    return Math.min(1, this.smooth * 6);
  }

  silentFor(now: number) {
    return now - this.lastSound;
  }
}
