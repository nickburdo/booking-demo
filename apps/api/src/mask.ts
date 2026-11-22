// Masking of guest data in the public admin demo (ADR-021, docs/api.md → Admin).

/** "Olena Kovalenko" → "Olena K."; a single word stays as it is. */
export function maskName(name: string): string {
  const [first, second] = name.trim().split(/\s+/);
  if (!first) return "";
  return second ? `${first} ${second[0]!.toUpperCase()}.` : first;
}

/**
 * Keeps the country and operator code and the last two digits.
 * "+380671234567" → "+380 67 *** ** 67"; other countries: "+4420…67" → "+44 ******** 67".
 */
export function maskPhone(phone: string): string {
  if (/^\+380\d{9}$/.test(phone)) return `+380 ${phone.slice(4, 6)} *** ** ${phone.slice(-2)}`;
  if (phone.length < 6) return "*".repeat(phone.length);
  return `${phone.slice(0, 3)} ${"*".repeat(phone.length - 5)} ${phone.slice(-2)}`;
}
