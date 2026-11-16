/**
 * Pricing, quotes and subscriptions (spec feature 7). Pure rules, unit tested. All amounts in naira.
 *
 *   Quote: setup items × quantity + the first period of the plan (one month, or a year less the free months),
 *          less a one-off discount (a percentage of that total, or a fixed amount), never below zero.
 *   Subscription: active → due (7 days before renewal) → overdue (after the renewal date); suspended by hand.
 */

export type Billing = "monthly" | "annual";
export type SubStatus = "active" | "due" | "overdue" | "suspended";

export type QuoteLine = { item_id: string; name: string; unit: string; quantity: number; unit_price: number; amount: number };
export type QuoteInput = {
  items: { id: string; name: string; unit: string; unit_price: number; quantity: number }[];
  monthlyPrice: number;
  billing: Billing;
  annualFreeMonths: number;
  discount: { kind: "percent" | "fixed"; value: number } | null;
};
export type QuoteTotals = { lines: QuoteLine[]; setupTotal: number; periodFee: number; periodLabel: string; subtotal: number; discountAmount: number; firstPayment: number };

/** Rounds to kobo. */
export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Months actually paid for a year up front. */
export function paidMonths(billing: Billing, annualFreeMonths: number): number {
  return billing === "annual" ? Math.max(1, 12 - Math.max(0, Math.min(6, Math.floor(annualFreeMonths)))) : 1;
}

export function computeQuote(q: QuoteInput): QuoteTotals {
  const lines = q.items
    .filter((i) => i.quantity > 0)
    .map((i) => ({ item_id: i.id, name: i.name, unit: i.unit, quantity: Math.floor(i.quantity), unit_price: round2(i.unit_price), amount: round2(Math.floor(i.quantity) * i.unit_price) }));
  const setupTotal = round2(lines.reduce((a, l) => a + l.amount, 0));
  const months = paidMonths(q.billing, q.annualFreeMonths);
  const periodFee = round2(q.monthlyPrice * months);
  const periodLabel = q.billing === "annual" ? `First year (12 months, ${12 - months} free)` : "First month";
  const subtotal = round2(setupTotal + periodFee);
  const raw = !q.discount ? 0 : q.discount.kind === "percent" ? (subtotal * Math.min(100, Math.max(0, q.discount.value))) / 100 : Math.max(0, q.discount.value);
  const discountAmount = round2(Math.min(subtotal, raw));
  return { lines, setupTotal, periodFee, periodLabel, subtotal, discountAmount, firstPayment: round2(subtotal - discountAmount) };
}

/** The plan whose student range fits a school of this size (active plans only, lowest first). */
export function planForStudents<P extends { min_students: number; max_students: number | null; active: boolean; sort: number }>(plans: P[], students: number): P | null {
  return [...plans].filter((p) => p.active).sort((a, b) => a.sort - b.sort)
    .find((p) => students >= p.min_students && (p.max_students === null || students <= p.max_students)) ?? null;
}

export type Audience = "school" | "organisation";

/** "301–800 students", "801+ students"; for an organisation plan, staff: "1–25 staff". */
export function studentRange(min: number, max: number | null, audience: Audience | string = "school"): string {
  const who = audience === "organisation" ? "staff" : "students";
  return max === null ? `${min}+ ${who}` : `${min}–${max} ${who}`;
}

/** Adds whole months to an ISO date, keeping the day where it exists (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/** The next renewal date after one period. */
export function nextRenewal(fromIso: string, billing: Billing): string {
  return addMonths(fromIso, billing === "annual" ? 12 : 1);
}

/** Mirrors public.subscription_status in the database. */
export function subscriptionStatus(renewsOn: string, suspended: boolean, today: string): SubStatus {
  if (suspended) return "suspended";
  if (renewsOn < today) return "overdue";
  const due = addDays(today, 7);
  return renewsOn <= due ? "due" : "active";
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Q-2026-0042: the year and a running number. */
export function quoteNumber(year: number, seq: number): string {
  return `Q-${year}-${String(seq).padStart(4, "0")}`;
}

/** What one renewal costs: the agreed monthly price for one month, or a year less the free months. */
export function renewalAmount(agreedMonthly: number, billing: Billing, annualFreeMonths: number): number {
  return round2(agreedMonthly * paidMonths(billing, annualFreeMonths));
}
