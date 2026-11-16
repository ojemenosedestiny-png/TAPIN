/**
 * What the public website shows about pricing. The prices come from the super admin's Pricing page
 * (subscription_plans, price_items, platform_settings) and are loaded with loadPricing() in lib/pricing-data.ts.
 * Plans are monthly, chosen by school size. Only active plans appear; a plan at ₦0 says "Price on request".
 * One-time setup items are listed with their prices and quoted separately (quantities differ per school).
 */
import { paidMonths, planForStudents, round2, studentRange, type Billing } from "@/lib/subscriptions";

export type { Billing };
export type PayMethod = "card" | "transfer" | "ussd";

export type WebPlan = {
  id: string;
  name: string;
  min: number;
  max: number | null;
  /** "301–800 students" */
  range: string;
  /** ₦ per month. null = price on request. */
  monthlyPrice: number | null;
  features: string[];
  popular?: boolean;
};
export type SetupItem = { name: string; unit: string; price: number; description: string | null };

export type WebPricing = {
  /** School plans (by students): these are on the order form. */
  plans: WebPlan[];
  /** Office and company plans (by staff): listed for a quote. */
  orgPlans: WebPlan[];
  /** Months free when paying a year up front. 0 = no yearly option. */
  annualFreeMonths: number;
  setup: SetupItem[];
  /** "Most schools are live within N days." null = sentence left out. */
  liveWithinDays: number | null;
  contact: { city: string; phone: string | null; email: string | null; whatsapp: string | null };
};

export type PlanRowIn = { id: string; name: string; min_students: number; max_students: number | null; monthly_price: number | string; features: string[] | null; active: boolean; sort: number; audience?: string | null };
export type ItemRowIn = { name: string; unit: string; unit_price: number | string; description: string | null; active: boolean };
export type SettingsIn = { annual_free_months?: number | null; live_within_days?: number | null; phone?: string | null; email?: string | null; whatsapp?: string | null } | null;

/** Builds the website's prices from the database rows. Inactive plans and items, and items at ₦0, are left out. */
export function pricingFrom(plans: PlanRowIn[], items: ItemRowIn[], s: SettingsIn): WebPricing {
  const active = plans.filter((p) => p.active).sort((a, b) => a.sort - b.sort);
  const toWeb = (list: PlanRowIn[]): WebPlan[] => list.map((p, i) => ({
    id: p.id, name: p.name, min: p.min_students, max: p.max_students, range: studentRange(p.min_students, p.max_students, p.audience ?? "school"),
    monthlyPrice: Number(p.monthly_price) > 0 ? Number(p.monthly_price) : null, features: p.features ?? [],
    popular: list.length >= 3 && i === 1,
  }));
  return {
    plans: toWeb(active.filter((p) => (p.audience ?? "school") === "school")),
    orgPlans: toWeb(active.filter((p) => p.audience === "organisation")),
    annualFreeMonths: Math.max(0, Math.min(6, s?.annual_free_months ?? 0)),
    setup: items.filter((i) => i.active && Number(i.unit_price) > 0).map((i) => ({ name: i.name, unit: i.unit, price: Number(i.unit_price), description: i.description })),
    liveWithinDays: s?.live_within_days ?? null,
    contact: { city: "Abuja, Nigeria", phone: s?.phone || null, email: s?.email || null, whatsapp: s?.whatsapp || null },
  };
}

/** Nothing set yet (or the database is unreachable): no plans, prices on request. */
export const DEFAULT_PRICING: WebPricing = pricingFrom([], [], null);

export const METHODS: { id: PayMethod; name: string; note: string }[] = [
  { id: "card", name: "Card", note: "Visa, Mastercard, Verve" },
  { id: "transfer", name: "Bank transfer", note: "Pay into a one-time account" },
  { id: "ussd", name: "USSD", note: "Any bank, no internet" },
];

export function naira(n: number): string {
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}

/** The plan for a school of this size. */
export function webPlanFor(cfg: WebPricing, students: number): WebPlan | null {
  return planForStudents(cfg.plans.map((p, i) => ({ ...p, min_students: p.min, max_students: p.max, active: true, sort: i })), students);
}

/** What the first period costs: one month, or a year less the free months. Null = price on request. */
export function periodPrice(plan: WebPlan, billing: Billing, freeMonths: number): number | null {
  if (plan.monthlyPrice === null) return null;
  return round2(plan.monthlyPrice * paidMonths(billing, freeMonths));
}

export type Quote = { plan: WebPlan; due: number } | null;

/** What is due today for a school order (the first month or year; setup is quoted separately). Null = a quote. */
export function quoteFor(planId: string, billing: Billing, students: number, cfg: WebPricing): Quote {
  const plan = cfg.plans.find((p) => p.id === planId);
  if (!plan || !Number.isInteger(students) || students < 1) return null;
  if (billing === "annual" && cfg.annualFreeMonths === 0) return null; // no yearly option offered
  if (students < plan.min || (plan.max !== null && students > plan.max)) return null;
  const due = periodPrice(plan, billing, cfg.annualFreeMonths);
  return due === null ? null : { plan, due };
}
