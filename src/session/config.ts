// Сроки задаются при сборке (VITE_IDLE_LIMIT_MS), по умолчанию 10 минут. Значение предварительное: его надо согласовать с клиникой.
const raw = Number(import.meta.env.VITE_IDLE_LIMIT_MS);
export const IDLE_LIMIT_MS = Number.isFinite(raw) && raw >= 15_000 && raw <= 8 * 3_600_000 ? raw : 10 * 60_000;
/** Предупреждение за минуту до выхода (но не больше трети срока). */
export const IDLE_WARN_MS = Math.min(60_000, Math.floor(IDLE_LIMIT_MS / 3));
/** Пока человек работает, сервер должен считать сессию живой (на сервере она истекает через 15 минут без запросов). */
export const HEARTBEAT_MS = 4 * 60_000;
