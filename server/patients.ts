import { makePin } from "../src/data/pin";
import type { Patient } from "../src/domain/patient";

// Все данные вымышленные (демо).
const raw: Omit<Patient, "pin">[] = [
  { id: "p1", name: "Иванова Анна Сергеевна", sex: "F", birthDate: "1987-03-14", allergies: ["пенициллин"] },
  { id: "p2", name: "Петров Азамат Бакытович", sex: "M", birthDate: "1975-11-02", allergies: [] },
  { id: "p3", name: "Сыдыкова Айгуль Маратовна", sex: "F", birthDate: "1992-07-29", allergies: [] },
  { id: "p4", name: "Токтогулов Эрмек Канатбекович", sex: "M", birthDate: "2001-01-09", allergies: ["аспирин"] },
];

export const patients: Patient[] = raw.map((p, i) => ({
  ...p,
  pin: makePin(p.sex, p.birthDate, 10001 + i * 137),
}));
