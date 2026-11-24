export type Sex = "F" | "M";

/**
 * ПИН Кыргызстана: 14 цифр.
 * 1-я цифра — пол (ASSUMPTION: 1 = женщина, 2 = мужчина; сверить с официальной
 * спецификацией), затем дата рождения ДДММГГГГ, затем 5 цифр порядкового номера.
 */
export function makePin(sex: Sex, birthDate: string, serial: number): string {
  const [y, m, d] = birthDate.split("-");
  if (!y || !m || !d) throw new Error(`Bad date: ${birthDate}`);
  return `${sex === "F" ? 1 : 2}${d}${m}${y}${String(serial).padStart(5, "0")}`;
}

export function isValidPin(pin: string, sex: Sex, birthDate: string): boolean {
  if (!/^\d{14}$/.test(pin)) return false;
  const [y, m, d] = birthDate.split("-");
  return pin[0] === (sex === "F" ? "1" : "2") && pin.slice(1, 9) === `${d}${m}${y}`;
}

export function formatPin(pin: string): string {
  return `${pin[0]} ${pin.slice(1, 9)} ${pin.slice(9)}`;
}
