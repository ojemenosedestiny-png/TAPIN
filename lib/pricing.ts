/**
 * TapIn's public plans and the maths behind the pricing page. The prices themselves are set by the super admin
 * on the Billing page (platform_settings) and loaded with loadPricing() in lib/pricing-data.ts.
 * Anything not set is simply not shown on the website (a plan without a price says "Price on request").
 * Prices are in naira, per student, per term.
 */
export type PlanId = "starter" | "standard" | "campus";
export type Billing = "term" | "year";
export type PayMethod = "card" | "transfer" | "ussd";

export type Plan = {
  id: PlanId;
  name: string;
  blurb: string;
  /** ₦ per student per term. null = price on request. */
  termPrice: number | null;
  features: string[];
  popular?: boolean;
  /** Always a quote (several campuses). */
  custom?: boolean;
};

export type WebPricing = {
  plans: Plan[];
  /** Paying for a whole year (three terms) at once: percentage off. null = no yearly option shown. */
  yearlyDiscountPct: number | null;
  /** One-time setup: kiosk installation, printed smart ID cards, student registration. ₦. null = not shown. */
  setupFee: number | null;
  /** "Most schools are live within N days." null = sentence left out. */
  liveWithinDays: number | null;
  contact: { city: string; phone: string | null; email: string | null; whatsapp: string | null };
};

/** The row the super admin edits (platform_settings). */
export type PricingSettings = {
  starter_price?: number | string | null; standard_price?: number | string | null; web_setup_fee?: number | string | null;
  yearly_discount_pct?: number | string | null; live_within_days?: number | null;
  phone?: string | null; email?: string | null; whatsapp?: string | null; address?: string | null;
} | null;

const num = (v: number | string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Builds the website's prices from the saved settings. Unset values stay null and are left off the site. */
export function pricingFrom(s: PricingSettings): WebPricing {
  return {
    plans: [
      { id: "starter", name: "Starter", blurb: "For smaller schools with one gate.", termPrice: num(s?.starter_price), features: ["1 kiosk", "Arrival and absence alerts", "Admin dashboard"] },
      { id: "standard", name: "Standard", blurb: "Most popular. Everything a growing school needs.", termPrice: num(s?.standard_price), popular: true, features: ["Up to 3 kiosks", "Arrival, departure and absence alerts", "Staff attendance and reports"] },
      { id: "campus", name: "Campus", blurb: "For schools with several campuses.", termPrice: null, custom: true, features: ["Unlimited kiosks and campuses", "Everything in Standard", "Dedicated support"] },
    ],
    yearlyDiscountPct: num(s?.yearly_discount_pct),
    setupFee: num(s?.web_setup_fee),
    liveWithinDays: s?.live_within_days ?? null,
    contact: { city: "Abuja, Nigeria", phone: s?.phone || null, email: s?.email || null, whatsapp: s?.whatsapp || null },
  };
}

/** Nothing set yet: every plan on request. */
export const DEFAULT_PRICING: WebPricing = pricingFrom(null);

export const METHODS: { id: PayMethod; name: string; note: string }[] = [
  { id: "card", name: "Card", note: "Visa, Mastercard, Verve" },
  { id: "transfer", name: "Bank transfer", note: "Pay into a one-time account" },
  { id: "ussd", name: "USSD", note: "Any bank, no internet" },
];

export const TERMS_PER_YEAR = 3;

export function naira(n: number): string {
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}

/** ₦ per student for the chosen billing period, or null if the plan is priced on request. */
export function pricePerStudent(plan: Plan, billing: Billing, yearlyDiscountPct: number | null): number | null {
  if (plan.custom || plan.termPrice === null) return null;
  if (billing === "term") return plan.termPrice;
  const year = plan.termPrice * TERMS_PER_YEAR * (1 - (yearlyDiscountPct ?? 0) / 100);
  return Math.round(year * 100) / 100;
}

export type Quote = { perStudent: number; subtotal: number; setup: number; total: number } | null;

/** What is due today for a school order. Null when the plan needs a quote. */
export function quoteFor(planId: PlanId, billing: Billing, students: number, cfg: WebPricing): Quote {
  const plan = cfg.plans.find((p) => p.id === planId);
  if (!plan || !Number.isInteger(students) || students < 1) return null;
  if (billing === "year" && cfg.yearlyDiscountPct === null) return null; // no yearly option offered
  const per = pricePerStudent(plan, billing, cfg.yearlyDiscountPct);
  if (per === null) return null;
  const subtotal = Math.round(per * students * 100) / 100;
  const setup = cfg.setupFee ?? 0;
  return { perStudent: per, subtotal, setup, total: Math.round((subtotal + setup) * 100) / 100 };
}
