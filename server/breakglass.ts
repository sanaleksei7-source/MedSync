// Экстренный доступ (break-glass): врач без закрепления может на короткое время открыть карту пациента, назвав причину.
// Доступ ограничен по времени и числу карт, каждый случай попадает в журнал и вызывает тревогу у аудитора.
// Причина выбирается из списка, а не пишется свободным текстом: в журнал не должно попадать медицинское содержимое.
export const REASONS = {
  emergency: "Неотложное состояние пациента",
  unconscious: "Пациент без сознания, нет возможности уточнить",
  covering: "Замещаю коллегу",
  transfer: "Пациент переведён, закрепление ещё не оформлено",
} as const;
export type Reason = keyof typeof REASONS;
export const isReason = (x: unknown): x is Reason => typeof x === "string" && Object.prototype.hasOwnProperty.call(REASONS, x);

export const GRANT_MS = 30 * 60_000;
export const MAX_ACTIVE = 3;

export class BreakGlass {
  private grants = new Map<string, Map<string, number>>(); // врач → пациент → когда истекает
  /** Выдан ли доступ. Выдача хранится в памяти: после перезапуска сервера все экстренные доступы закрываются. */
  grant(userId: string, patientId: string, now: number): "ok" | "limit" {
    const m = this.grants.get(userId) ?? new Map<string, number>();
    this.prune(m, now);
    if (!m.has(patientId) && m.size >= MAX_ACTIVE) { this.grants.set(userId, m); return "limit"; }
    m.set(patientId, now + GRANT_MS);
    this.grants.set(userId, m);
    return "ok";
  }
  active(userId: string, now: number): string[] {
    const m = this.grants.get(userId);
    if (!m) return [];
    this.prune(m, now);
    return [...m.keys()];
  }
  end(userId: string, patientId: string): boolean {
    return this.grants.get(userId)?.delete(patientId) ?? false;
  }
  endAll(userId: string) { this.grants.delete(userId); }
  expiresAt(userId: string, patientId: string): number | undefined { return this.grants.get(userId)?.get(patientId); }
  private prune(m: Map<string, number>, now: number) { for (const [p, t] of [...m]) if (t <= now) m.delete(p); }
}
