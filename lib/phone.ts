/**
 * Nigerian phone numbers → E.164 (+234XXXXXXXXXX), which Termii expects.
 * Accepts 08031234567, 8031234567, 2348031234567, +234 803 123 4567, 0803-123-4567.
 * Returns null when it can't be a Nigerian mobile number.
 */
export function normaliseNgPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.includes("+")) return null;

  if (digits.startsWith("234")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);

  // National significant number for mobiles: 10 digits starting 7, 8 or 9.
  if (!/^[789][01]\d{8}$/.test(digits)) return null;
  return `+234${digits}`;
}

/** +2348031234567 → 0803 123 4567 */
export function formatNgPhone(e164: string): string {
  const m = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : e164;
}
