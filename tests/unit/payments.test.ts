import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PRICING, periodPrice, pricingFrom, quoteFor, webPlanFor, type PlanRowIn } from "@/lib/pricing";
import { initializePayment, newReference, validWebhookHash, verifyPayment } from "@/lib/flutterwave";

const rows: PlanRowIn[] = [
  { id: "p1", name: "Starter", min_students: 0, max_students: 300, monthly_price: "40000.00", features: ["1 kiosk"], active: true, sort: 1 },
  { id: "p2", name: "Standard", min_students: 301, max_students: 800, monthly_price: 75000, features: null, active: true, sort: 2 },
  { id: "p3", name: "Premium", min_students: 801, max_students: null, monthly_price: 0, features: [], active: true, sort: 3 },
  { id: "p4", name: "Old plan", min_students: 0, max_students: null, monthly_price: 1, features: [], active: false, sort: 0 },
];
const items = [
  { name: "Kiosk", unit: "each", unit_price: "150000", description: null, active: true },
  { name: "Wristband", unit: "each", unit_price: 0, description: null, active: true },
  { name: "Old card", unit: "each", unit_price: 900, description: null, active: false },
];
const cfg = pricingFrom(rows, items, { annual_free_months: 2, live_within_days: 7, phone: "+234 803 000 0000", email: null, whatsapp: "2348030000000" });

describe("website plans", () => {
  it("shows only active plans, in order, with ranges; ₦0 means price on request", () => {
    expect(cfg.plans.map((p) => [p.name, p.range, p.monthlyPrice])).toEqual([
      ["Starter", "0–300 students", 40000], ["Standard", "301–800 students", 75000], ["Premium", "801+ students", null],
    ]);
    expect(cfg.plans.map((p) => !!p.popular)).toEqual([false, true, false]);
  });
  it("lists only active setup items with a price", () => {
    expect(cfg.setup).toEqual([{ name: "Kiosk", unit: "each", price: 150000, description: null }]);
    expect(cfg).toMatchObject({ annualFreeMonths: 2, liveWithinDays: 7, contact: { whatsapp: "2348030000000" } });
  });
  it("the plan follows the school's size", () => {
    expect(webPlanFor(cfg, 120)?.name).toBe("Starter");
    expect(webPlanFor(cfg, 301)?.name).toBe("Standard");
    expect(webPlanFor(cfg, 5000)?.name).toBe("Premium");
  });
  it("due today is the first month, or a year less the free months", () => {
    expect(quoteFor("p2", "monthly", 400, cfg)?.due).toBe(75000);
    expect(quoteFor("p1", "annual", 100, cfg)?.due).toBe(400000);
    expect(periodPrice(cfg.plans[0]!, "annual", 0)).toBe(480000);
  });
  it("needs a quote for unpriced plans, wrong sizes, nonsense counts, or yearly when not offered", () => {
    expect(quoteFor("p3", "monthly", 900, cfg)).toBeNull();
    expect(quoteFor("p1", "monthly", 500, cfg)).toBeNull();
    expect(quoteFor("p1", "monthly", 0, cfg)).toBeNull();
    expect(quoteFor("p1", "monthly", 12.5, cfg)).toBeNull();
    expect(quoteFor("p1", "annual", 100, { ...cfg, annualFreeMonths: 0 })).toBeNull();
  });
  it("shows no made-up prices until the super admin sets them", () => {
    expect(DEFAULT_PRICING.plans).toEqual([]);
    expect(DEFAULT_PRICING.setup).toEqual([]);
  });
});

describe("Flutterwave", () => {
  it("references are unique and recognisable", () => {
    const a = newReference("SCH"), b = newReference("SCH");
    expect(a).toMatch(/^TAPIN-SCH-[0-9A-F]{12}$/);
    expect(a).not.toBe(b);
  });

  it("starts a payment in naira, for the chosen method, and returns the checkout page", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ status: "success", data: { link: "https://checkout.flutterwave.com/v3/hosted/pay/abc" } }), { status: 200 }));
    const r = await initializePayment({ key: "FLWSECK_TEST-x", email: "a@b.ng", phone: "+2348030000000", amount: 650000.5, reference: "TAPIN-SCH-ABCDEF123456", method: "transfer", redirectUrl: "https://tapin/done", meta: {} }, fetchImpl as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, url: "https://checkout.flutterwave.com/v3/hosted/pay/abc" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.flutterwave.com/v3/payments");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer FLWSECK_TEST-x");
    expect(JSON.parse(init.body as string)).toMatchObject({ tx_ref: "TAPIN-SCH-ABCDEF123456", amount: 650000.5, currency: "NGN", payment_options: "banktransfer", redirect_url: "https://tapin/done", customer: { email: "a@b.ng", phone_number: "+2348030000000" } });
  });

  it("reports a refusal or an outage instead of throwing", async () => {
    const base = { key: "k", email: "a@b.ng", amount: 1, reference: "r", method: "card" as const, redirectUrl: "u", meta: {} };
    expect(await initializePayment(base, (async () => new Response(JSON.stringify({ status: "error", message: "Invalid authorization key" }), { status: 401 })) as typeof fetch))
      .toEqual({ ok: false, error: "Invalid authorization key" });
    expect((await initializePayment(base, (async () => { throw new TypeError("fetch failed"); }) as typeof fetch)).ok).toBe(false);
  });

  it("only counts a payment Flutterwave itself confirms, in naira, for this reference", async () => {
    const reply = (data: object) => (async () => new Response(JSON.stringify({ status: "success", data }))) as typeof fetch;
    expect(await verifyPayment("k", "R1", reply({ status: "successful", amount: 650000.5, currency: "NGN", tx_ref: "R1" }))).toEqual({ paid: true, amount: 650000.5, reference: "R1" });
    expect((await verifyPayment("k", "R1", reply({ status: "failed", amount: 100, currency: "NGN", tx_ref: "R1" })))?.paid).toBe(false);
    expect((await verifyPayment("k", "R1", reply({ status: "successful", amount: 100, currency: "USD", tx_ref: "R1" })))?.paid).toBe(false);
    expect((await verifyPayment("k", "R1", reply({ status: "successful", amount: 100, currency: "NGN", tx_ref: "OTHER" })))?.paid).toBe(false);
  });

  it("accepts only webhooks carrying our secret hash", () => {
    expect(validWebhookHash("my-secret-hash", "my-secret-hash")).toBe(true);
    expect(validWebhookHash("my-secret-hash", "guess")).toBe(false);
    expect(validWebhookHash("my-secret-hash", null)).toBe(false);
    expect(validWebhookHash(undefined, "anything")).toBe(false);
  });
});
