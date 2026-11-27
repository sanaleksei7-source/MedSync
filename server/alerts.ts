// Оповещения о необычном доступе (шаг 3.4). Монитор смотрит на каждую запись журнала аудита и поднимает тревогу,
// когда видит похожее на подбор доступа, массовое чтение карт или работу в нерабочее время.
// Тревога сама записывается в журнал (action "alert.*"), чтобы её нельзя было потом отрицать, и доступна аудитору.
// Пороги ниже — стартовые, их нужно подобрать по реальной нагрузке клиники.
import type { AuditEvent, AuditRecord } from "./audit";

export interface Alert { rule: string; key: string; count: number; message: string }

export interface AlertConfig {
  windowMs: number;       // окно подсчёта
  cooldownMs: number;     // повторную тревогу по тому же правилу и ключу не поднимаем чаще
  deniedLimit: number;    // отказов в доступе одному пользователю за окно
  loginFailLimit: number; // неудачных входов под одним именем за окно
  readLimit: number;      // чтений карт и списков одним пользователем за окно
  workHours: [number, number]; // [с, до) по местному времени клиники
  utcOffsetHours: number; // сдвиг местного времени от UTC (Кыргызстан: +6)
}

export const DEFAULT_ALERTS: AlertConfig = {
  windowMs: 10 * 60_000,
  cooldownMs: 10 * 60_000,
  deniedLimit: 5,
  loginFailLimit: 10,
  readLimit: 100,
  workHours: [6, 22],
  utcOffsetHours: 6,
};

const DENIED = new Set(["visit.denied", "document.sign.denied"]);
const READS = new Set(["visit.read", "visit.list", "patient.list"]);
const PATIENT_DATA = new Set(["visit.read", "visit.list", "patient.list", "visit.create", "visit.transcript", "visit.decision", "document.sign", "extract.request"]);

export class AlertMonitor {
  private hits = new Map<string, number[]>();
  private last = new Map<string, number>();
  constructor(private cfg: AlertConfig = DEFAULT_ALERTS) {}

  private count(bucket: string, t: number): number {
    const arr = (this.hits.get(bucket) ?? []).filter((x) => t - x < this.cfg.windowMs);
    arr.push(t);
    this.hits.set(bucket, arr);
    return arr.length;
  }

  private raise(rule: string, key: string, count: number, message: string, t: number): Alert | null {
    const id = `${rule}|${key}`;
    const prev = this.last.get(id);
    if (prev !== undefined && t - prev < this.cfg.cooldownMs) return null;
    this.last.set(id, t);
    return { rule, key, count, message };
  }

  /** Возвращает тревоги, вызванные этим событием. Сами тревоги и служебные записи не считаются. */
  observe(e: AuditEvent): Alert[] {
    if (e.action.startsWith("alert.") || e.actor === "system") return [];
    const t = Date.parse(e.time);
    if (Number.isNaN(t)) return [];
    const out: (Alert | null)[] = [];
    const c = this.cfg;

    if (DENIED.has(e.action)) {
      const n = this.count(`denied|${e.actor}`, t);
      if (n >= c.deniedLimit) out.push(this.raise("denied.burst", e.actor, n, `Много отказов в доступе подряд (${n} за ${c.windowMs / 60000} мин)`, t));
    }
    if (e.action === "login.fail") {
      const user = String(e.detail?.user ?? "?");
      const n = this.count(`loginfail|${user}`, t);
      if (n >= c.loginFailLimit) out.push(this.raise("login.fail.burst", user, n, `Подбор пароля: ${n} неудачных входов за ${c.windowMs / 60000} мин`, t));
    }
    if (e.action === "token.reuse") out.push(this.raise("token.reuse", e.actor, 1, "Повторное использование токена обновления: возможна кража токена", t));
    if (READS.has(e.action)) {
      const n = this.count(`read|${e.actor}`, t);
      if (n >= c.readLimit) out.push(this.raise("read.burst", e.actor, n, `Необычно много чтений карт (${n} за ${c.windowMs / 60000} мин)`, t));
    }
    if (PATIENT_DATA.has(e.action)) {
      const hour = new Date(t + c.utcOffsetHours * 3_600_000).getUTCHours();
      const [from, to] = c.workHours;
      if (hour < from || hour >= to) out.push(this.raise("off.hours", e.actor, 1, `Работа с данными пациентов в нерабочее время (${String(hour).padStart(2, "0")}:00)`, t));
    }
    return out.filter((x): x is Alert => x !== null);
  }
}

export const isAlert = (r: Pick<AuditRecord, "action">) => r.action.startsWith("alert.");
