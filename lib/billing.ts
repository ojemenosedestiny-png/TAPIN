/**
 * Billing (build plan §9): setup fee once, then a monthly fee per active student, plus SMS when
 * the school pays per message. Pure functions — unit tested.
 */
export type Pricing = { price_per_student: number; setup_fee: number; price_per_sms: number };
export type Usage = { active_students: number; sms_sent: number };
export type InvoiceLine = { description: string; quantity: number; unit_price: number; amount: number };

/** Money in kobo-safe arithmetic: round to 2 decimals at every step. */
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function monthLabel(period: string): string {
  return new Date(`${period}T12:00:00Z`).toLocaleDateString("en-NG", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** First day of the month for any YYYY-MM or YYYY-MM-DD; null if invalid. */
export function toPeriod(input: string | undefined | null): string | null {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(input ?? "");
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

export function invoiceLines(p: Pricing, u: Usage, opts: { period: string; firstInvoice: boolean }): { lines: InvoiceLine[]; total: number } {
  const lines: InvoiceLine[] = [];
  const add = (description: string, quantity: number, unit_price: number) => {
    if (quantity <= 0 || unit_price <= 0) return;
    lines.push({ description, quantity, unit_price: round2(unit_price), amount: round2(quantity * unit_price) });
  };
  if (opts.firstInvoice) add("Setup: hardware, cards and installation", 1, p.setup_fee);
  add(`Attendance and alerts, ${monthLabel(opts.period)} (per active student)`, u.active_students, p.price_per_student);
  add(`SMS sent in ${monthLabel(opts.period)}`, u.sms_sent, p.price_per_sms);
  return { lines, total: round2(lines.reduce((a, l) => a + l.amount, 0)) };
}

/** TAP-202611-001 */
export function invoiceNumber(prefix: string, period: string, sequence: number): string {
  return `${prefix}-${period.slice(0, 4)}${period.slice(5, 7)}-${String(sequence).padStart(3, "0")}`;
}

export function naira(n: number): string {
  return `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
