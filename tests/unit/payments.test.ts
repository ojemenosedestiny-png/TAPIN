import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PRICING, pricingFrom, pricePerStudent, quoteFor, type Plan } from "@/lib/pricing";
import { initializePayment, newReference, validWebhookHash, verifyPayment } from "@/lib/flutterwave";

const cfg = {
  ...DEFAULT_PRICING,
  plans: [
    { id: "starter", name: "Starter", blurb: "", termPrice: 1000, features: [] },
    { id: "standard", name: "Standard", blurb: "", termPrice: 1500, features: [] },
    { id: "campus", name: "Campus", blurb: "", termPrice: null, custom: true, features: [] },
  ] as Plan[],
  yearlyDiscountPct: 10,
  setupFee: 50000,
};

describe("plan prices", () => {
  it("charges per student per term, plus the one-time setup", () => {
    expect(quoteFor("standard", "term", 400, cfg)).toEqual({ perStudent: 1500, subtotal: 600000, setup: 50000, total: 650000 });
  });
  it("a year is three terms, less the yearly saving", () => {
    expect(pricePerStudent(cfg.plans[0]!, "year", 10)).toBe(2700);
    expect(quoteFor("starter", "year", 100, cfg)?.total).toBe(270000 + 50000);
  });
  it("campus and unpriced plans need a quote, and nonsense student counts give nothing", () => {
    expect(quoteFor("campus", "term", 400, cfg)).toBeNull();
    expect(quoteFor("standard", "term", 0, cfg)).toBeNull();
    expect(quoteFor("standard", "term", 12.5, cfg)).toBeNull();
    expect(quoteFor("standard", "term", 100, { ...cfg, plans: cfg.plans.map((p) => ({ ...p, termPrice: null })) })).toBeNull();
  });
  it("shows no made-up prices until the super admin sets them", () => {
    expect(DEFAULT_PRICING.plans.map((p) => p.termPrice)).toEqual([null, null, null]);
    expect(DEFAULT_PRICING.setupFee).toBeNull();
  });
  it("builds the website's prices from the saved settings", () => {
    const p = pricingFrom({ starter_price: "1200.00", standard_price: 1800, web_setup_fee: "0", yearly_discount_pct: "10", live_within_days: 7, phone: "+234 803 000 0000", email: null, whatsapp: "2348030000000" });
    expect(p.plans.map((x) => x.termPrice)).toEqual([1200, 1800, null]);
    expect(p).toMatchObject({ setupFee: 0, yearlyDiscountPct: 10, liveWithinDays: 7, contact: { phone: "+234 803 000 0000", email: null, whatsapp: "2348030000000" } });
  });
  it("offers no yearly price unless a yearly saving is set", () => {
    expect(quoteFor("standard", "year", 10, { ...cfg, yearlyDiscountPct: null })).toBeNull();
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
