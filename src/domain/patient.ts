// Карточка пациента, какой её отдаёт сервер. Сами данные пациентов в браузер и в сборку не попадают:
// клиент получает только тех, кто закреплён за вошедшим врачом, и только после входа.
import type { Sex } from "../data/pin";

export interface Patient {
  id: string;
  name: string;
  sex: Sex;
  birthDate: string; // ISO
  pin: string;
  allergies: string[];
}

/** Что клиент видит о пациенте. */
export type PatientView = Pick<Patient, "id" | "name" | "birthDate" | "pin" | "allergies">;

/** Строка списка приёмов (история). Текста разговора и документа здесь нет. */
export interface VisitSummary {
  id: string;
  patientId: string;
  patientName: string;
  docType: string;
  source: "demo" | "live";
  status: "draft" | "signed";
  hasDraft: boolean;
  updatedAt: string; // ISO
  signedAt?: string; // ISO
}
