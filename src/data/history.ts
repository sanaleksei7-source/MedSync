import { useSyncExternalStore } from "react";
import { patients } from "./patients";

export type HistoryStatus = "signed" | "sent";
export interface HistoryEntry {
  id: string;
  patientName: string;
  time: string; // ISO
  docLabel: string;
  status: HistoryStatus;
  hash?: string;
}

const daysAgo = (d: number, h: number) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  t.setHours(h, 0, 0, 0);
  return t.toISOString();
};

// Демо-записи (вымышленные). Новые подписанные документы добавляются сверху.
const seed = (): HistoryEntry[] => [
  { id: "h1", patientName: patients[1].name, time: daysAgo(1, 9), docLabel: "Осмотр", status: "sent" },
  { id: "h2", patientName: patients[2].name, time: daysAgo(2, 14), docLabel: "Справка", status: "sent" },
  { id: "h3", patientName: patients[3].name, time: daysAgo(4, 11), docLabel: "Направление", status: "sent" },
];

const KEY = "medsync-history-v1";
function load(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    /* localStorage недоступен или повреждён — используем демо-данные */
  }
  return seed();
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* не критично */
  }
}

let entries: HistoryEntry[] = load();
const listeners = new Set<() => void>();
const emit = () => {
  save();
  listeners.forEach((l) => l());
};

export function addEntry(e: HistoryEntry) {
  entries = [e, ...entries];
  emit();
}
export function updateEntry(id: string, patch: Partial<HistoryEntry>) {
  entries = entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
  emit();
}
export function resetHistory() {
  entries = seed();
  emit();
}
export function useHistory() {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => entries,
  );
}
