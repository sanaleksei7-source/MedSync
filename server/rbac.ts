// Роли и доступ к пациентам. Доступ к карте даётся только врачу, за которым пациент закреплён
// ("лечебные отношения"). Администратор и аудитор медицинских данных не видят.
export type Role = "doctor" | "admin" | "auditor";
export type Permission = "patient.read" | "visit.edit" | "document.sign" | "extract.run" | "asr.run" | "audit.verify" | "user.manage";

const grants: Record<Role, Permission[]> = {
  doctor: ["patient.read", "visit.edit", "document.sign", "extract.run", "asr.run"],
  admin: ["user.manage"],
  auditor: ["audit.verify"],
};

export interface Actor {
  id: string;
  role: Role;
  assignedPatients: string[];
}

export const can = (a: Actor, p: Permission) => grants[a.role].includes(p);

/** Право на действие над конкретным пациентом: роль + закрепление за врачом. */
export function canAccessPatient(a: Actor, p: Permission, patientId: string): boolean {
  if (!can(a, p)) return false;
  if (p === "audit.verify" || p === "user.manage") return true;
  return a.assignedPatients.includes(patientId);
}
