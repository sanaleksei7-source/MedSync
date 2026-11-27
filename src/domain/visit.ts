// Приём (visit): запись, которую держит СЕРВЕР. Браузер и приложение только показывают её и присылают действия врача.
// Подписывается то, что хранит сервер, а не то, что прислал клиент.
import type { DocType, Line, Section } from "../data/script";
import type { Action, Decisions } from "./rules";

export interface ChangeEntry {
  time: string; // ISO
  action: Action;
  before: string;
  after?: string;
}

export interface SignedInfo {
  hash: string;
  signature: string;
  signedAt: string; // ISO
  signer: string;
  scheme: string;
  demo: boolean;
}

/** Что сервер отдаёт клиенту. */
export interface VisitView {
  id: string;
  patientId: string;
  docType: DocType;
  source: "demo" | "live";
  status: "draft" | "signed";
  lines: Line[];
  sections: Section[] | null; // null — черновик ещё не составлен
  decisions: Decisions;
  ackAllergy: number[];
  changeLog: ChangeEntry[];
  signed?: SignedInfo;
}
