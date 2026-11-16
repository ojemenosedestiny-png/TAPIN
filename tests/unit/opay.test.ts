import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createCashier, newInvoiceReference, opayConfig, opayPaid, opaySignature, queryCashier, sortedJson, toKobo } from "@/lib/opay";

const cfg = opayConfig({ OPAY_MERCHANT_ID: "256612345678", OPAY_PUBLIC_KEY: "OPAYPUB123", OPAY_SECRET_KEY: "OPAYPRV456" })!;
const reply = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
const call = (f: typeof fetch) => (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;

describe("OPay", () => {
  it("is off without all three keys, and uses the sandbox unless told live", () => {
    expect(opayConfig({ OPAY_MERCHANT_ID: "1", OPAY_PUBLIC_KEY: "p" })).toBeNull();
    expect(cfg.base).toBe("https://sandboxapi.opaycheckout.com");
    expect(opayConfig({ OPAY_MERCHANT_ID: "1", OPAY_PUBLIC_KEY: "p", OPAY_SECRET_KEY: "s", OPAY_ENV: "live" })!.base).toBe("https://api.opaycheckout.com");
  });
  it("amounts go in kobo; references are recognisable", () => {
    expect(toKobo(15000.5)).toBe(1500050);
    expect(newInvoiceReference()).toMatch(/^TAPIN-INV-[0-9A-F]{12}$/);
  });
  it("signs the sorted JSON with HMAC-SHA512 of the secret key", () => {
    expect(sortedJson({ reference: "R", country: "NG", amount: { total: 1, currency: "NGN" } })).toBe('{"amount":{"currency":"NGN","total":1},"country":"NG","reference":"R"}');
    expect(opaySignature("abc", "key")).toBe(createHmac("sha512", "key").update("abc").digest("hex"));
  });
  it("starts a checkout with the public key, in naira kobo, and returns OPay's page", async () => {
    const f = reply({ code: "00000", message: "SUCCESSFUL", data: { cashierUrl: "https://cashier.opaycheckout.com/x", orderNo: "2110" } });
    const r = await createCashier(cfg, {
      reference: "TAPIN-INV-AAAAAAAAAAAA", amountNaira: 25000, description: "Invoice TAP-O202611-001",
      returnUrl: "https://www.tapinsafe.app/invoices/1?paid=R", cancelUrl: "https://www.tapinsafe.app/invoices/1", callbackUrl: "https://www.tapinsafe.app/api/opay/callback",
      user: { id: "u1", name: "Ada Admin", email: "ada@example.com" },
    }, f);
    expect(r).toEqual({ ok: true, url: "https://cashier.opaycheckout.com/x", orderNo: "2110" });
    const [url, init] = call(f);
    expect(url).toBe("https://sandboxapi.opaycheckout.com/api/v1/international/cashier/create");
    expect(init.headers).toMatchObject({ Authorization: "Bearer OPAYPUB123", MerchantId: "256612345678" });
    expect(JSON.parse(init.body as string)).toMatchObject({ country: "NG", reference: "TAPIN-INV-AAAAAAAAAAAA", amount: { total: 2500000, currency: "NGN" } });
  });
  it("reports OPay's refusal", async () => {
    expect(await createCashier(cfg, { reference: "R", amountNaira: 1, description: "d", returnUrl: "x", cancelUrl: "x", callbackUrl: "x", user: { id: "u", name: "n" } },
      reply({ code: "02004", message: "the payment reference already exists." }))).toEqual({ ok: false, error: "OPay: the payment reference already exists." });
  });
  it("asks the status signed with the secret key, and only a full NGN SUCCESS for this reference counts as paid", async () => {
    const f = reply({ code: "00000", data: { reference: "TAPIN-INV-AAAAAAAAAAAA", orderNo: "9", status: "SUCCESS", amount: { total: 2500000, currency: "NGN" } } });
    const s = await queryCashier(cfg, "TAPIN-INV-AAAAAAAAAAAA", f);
    const [url, init] = call(f);
    expect(url).toBe("https://sandboxapi.opaycheckout.com/api/v1/international/cashier/status");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${opaySignature(init.body as string, "OPAYPRV456")}`);
    expect(opayPaid(s, "TAPIN-INV-AAAAAAAAAAAA", 25000)).toBe(true);
    expect(opayPaid(s, "TAPIN-INV-AAAAAAAAAAAA", 30000)).toBe(false); // short payment
    expect(opayPaid(s, "TAPIN-INV-BBBBBBBBBBBB", 25000)).toBe(false); // someone else's payment
    expect(opayPaid({ ...s!, status: "PENDING" }, "TAPIN-INV-AAAAAAAAAAAA", 25000)).toBe(false);
    expect(await queryCashier(cfg, "R", reply({ code: "02000", message: "authentication failed" }))).toBeNull();
  });
});
