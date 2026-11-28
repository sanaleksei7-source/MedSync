// Автоматический выход при бездействии (общий ноутбук в клинике). Чистая логика без таймеров и браузера — её проверяют тестом.

export type IdleStatus = { state: "active" } | { state: "warning"; secondsLeft: number } | { state: "expired" };

export class IdleState {
  private last: number;
  private done = false;
  /** limitMs — сколько можно ничего не делать; warnMs — за сколько до выхода показать предупреждение. */
  constructor(now: number, private limitMs: number, private warnMs: number) {
    this.last = now;
  }

  /** Любое действие человека. После выхода уже ничего не меняет. */
  activity(now: number) {
    if (!this.done) this.last = now;
  }

  idleFor(now: number) {
    return now - this.last;
  }

  status(now: number): IdleStatus {
    if (this.done) return { state: "expired" };
    const idle = now - this.last;
    if (idle >= this.limitMs) {
      this.done = true;
      return { state: "expired" };
    }
    if (idle >= this.limitMs - this.warnMs) return { state: "warning", secondsLeft: Math.ceil((this.limitMs - idle) / 1000) };
    return { state: "active" };
  }
}

/**
 * Пока что-то важное идёт без участия мыши и клавиатуры (запись разговора с микрофона),
 * приложение не должно выходить само: врач говорит с пациентом, а не нажимает кнопки.
 */
let holds = 0;
export function holdSession(): () => void {
  holds++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      holds--;
    }
  };
}
export const sessionHeld = () => holds > 0;
