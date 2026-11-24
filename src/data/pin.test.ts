import { patients } from "./patients";
import { isValidPin } from "./pin";

let bad = 0;
for (const p of patients) {
  const ok = isValidPin(p.pin, p.sex, p.birthDate);
  console.log(ok ? "ok " : "BAD", p.pin, p.name);
  if (!ok) bad++;
}
if (bad) process.exit(1);
