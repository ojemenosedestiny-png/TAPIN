/**
 * Paying an invoice online, against a real Supabase project (throwaway school; OPay itself is faked).
 *   RUN_RLS_TESTS=1 npx vitest run tests/integration/invoice-payments.test.ts
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { settleInvoicePayment } from "@/lib/invoice-payments";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = process.env.RUN_RLS_TESTS === "1" && !!url && !!service;

let db: SupabaseClient;
const ids: Record<string, string> = {};
const stamp = Date.now().toString(16).toUpperCase().slice(-6);
const REF_OK = `TAPIN-INV-${stamp}A00001`.slice(0, 22);
const REF_SHORT = `TAPIN-INV-${stamp}B00002`.slice(0, 22);

const realFetch = globalThis.fetch;

/** OPay's status answer, for whichever reference was asked. Everything else (the database) goes through. */
function fakeOpay(status: string, totalKobo: number, onOpay?: () => void) {
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!u.includes("opaycheckout.com")) return realFetch(input, init);
    onOpay?.();
    const { reference } = JSON.parse(init!.body as string) as { reference: string };
    return new Response(JSON.stringify({ code: "00000", data: { reference, orderNo: "99", status, amount: { total: totalKobo, currency: "NGN" } } }), { status: 200 });
  }));
}

describe.skipIf(!enabled)("paying an invoice online", () => {
  beforeAll(async () => {
    vi.stubEnv("OPAY_MERCHANT_ID", "test");
    vi.stubEnv("OPAY_PUBLIC_KEY", "test");
    vi.stubEnv("OPAY_SECRET_KEY", "test");
    db = createClient(url!, service!, { auth: { persistSession: false } });
    const { data: s } = await db.from("schools").insert({ name: `invpay-test-${Date.now()}` }).select("id").single();
    ids.school = s!.id;
    const mk = async (n: string) => {
      const { data: inv } = await db.from("invoices").insert({ school_id: ids.school, kind: "order", period: "2026-11-01", number: `INVPAY-${stamp}-${n}`, lines: [], total: 15000 }).select("id").single();
      return inv!.id as string;
    };
    ids.inv1 = await mk("1");
    ids.inv2 = await mk("2");
    const { data: o } = await db.from("school_orders").insert({ school_id: ids.school, invoice_id: ids.inv1, lines: [], total: 15000 }).select("id").single();
    ids.order = o!.id;
    await db.from("invoice_payments").insert([
      { invoice_id: ids.inv1, school_id: ids.school, reference: REF_OK, amount: 15000 },
      { invoice_id: ids.inv2, school_id: ids.school, reference: REF_SHORT, amount: 15000 },
    ]);
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (!db || !ids.school) return;
    await db.from("invoice_payments").delete().eq("school_id", ids.school);
    await db.from("school_orders").delete().eq("school_id", ids.school);
    await db.from("invoices").delete().eq("school_id", ids.school);
    await db.from("audit_logs").delete().eq("school_id", ids.school);
    await db.from("schools").delete().eq("id", ids.school);
  });

  it("not paid yet: nothing changes", async () => {
    fakeOpay("PENDING", 1500000);
    expect((await settleInvoicePayment(REF_OK)).status).toBe("pending");
    expect((await db.from("invoices").select("status").eq("id", ids.inv1!).single()).data!.status).toBe("issued");
  });

  it("paid in full: the payment, the invoice and its order are all paid", async () => {
    fakeOpay("SUCCESS", 1500000);
    expect(await settleInvoicePayment(REF_OK)).toEqual({ status: "paid", invoiceId: ids.inv1 });
    expect((await db.from("invoices").select("status").eq("id", ids.inv1!).single()).data!.status).toBe("paid");
    expect((await db.from("school_orders").select("status").eq("id", ids.order!).single()).data!.status).toBe("paid");
    // Asking again changes nothing (and doesn't ask OPay).
    let asked = false;
    fakeOpay("SUCCESS", 1500000, () => { asked = true; });
    expect((await settleInvoicePayment(REF_OK)).status).toBe("paid");
    expect(asked).toBe(false);
  });

  it("paid short: not marked paid", async () => {
    fakeOpay("SUCCESS", 1000000);
    expect((await settleInvoicePayment(REF_SHORT)).status).toBe("pending");
    expect((await db.from("invoices").select("status").eq("id", ids.inv2!).single()).data!.status).toBe("issued");
  });

  it("a reference that isn't ours is ignored", async () => {
    expect((await settleInvoicePayment("TAPIN-INV-000000000000")).status).toBe("unknown");
    expect((await settleInvoicePayment("anything")).status).toBe("unknown");
  });
});
