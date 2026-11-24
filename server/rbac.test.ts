import { can, canAccessPatient, type Actor } from "./rbac";

const doctor: Actor = { id: "d1", role: "doctor", assignedPatients: ["p1", "p2"] };
const admin: Actor = { id: "a1", role: "admin", assignedPatients: ["p1"] };
const auditor: Actor = { id: "x1", role: "auditor", assignedPatients: ["p1"] };

const t: [string, boolean][] = [
  ["doctor signs own patient", canAccessPatient(doctor, "document.sign", "p1")],
  ["doctor can't sign other's patient", !canAccessPatient(doctor, "document.sign", "p3")],
  ["doctor can't read other's patient", !canAccessPatient(doctor, "patient.read", "p3")],
  ["admin can't read patients even if listed", !canAccessPatient(admin, "patient.read", "p1")],
  ["admin can't sign", !can(admin, "document.sign")],
  ["auditor can't read patients", !canAccessPatient(auditor, "patient.read", "p1")],
  ["auditor verifies audit log", canAccessPatient(auditor, "audit.verify", "")],
  ["doctor can't verify audit log", !can(doctor, "audit.verify")],
  ["doctor can't manage users", !can(doctor, "user.manage")],
  ["admin manages users", can(admin, "user.manage")],
];
let bad = 0;
for (const [n, ok] of t) if (!ok) { bad++; console.error("FAIL", n); }
console.log(bad ? `BAD rbac (${bad})` : `ok rbac (${t.length})`);
if (bad) process.exit(1);
