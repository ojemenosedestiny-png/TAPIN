/**
 * OPay Checkout (Cashier), through its REST API (no library). Server only.
 * Env (all from OPay Business → Developer / API keys):
 *   OPAY_MERCHANT_ID   your merchant ID
 *   OPAY_PUBLIC_KEY    public key: starts a checkout
 *   OPAY_SECRET_KEY    secret (private) key: signs status checks
 *   OPAY_ENV           "live" for real money; anything else uses OPay's sandbox
 * Without the three keys, online payment is off and invoices are paid by bank transfer as before.
 * TapIn never trusts the browser or the callback alone: it asks OPay for the status, signed, and checks the amount.
 */
import { createHmac, randomBytes } from "node:crypto";

export type OpayConfig = { merchantId: string; publicKey: string; secretKey: string; base: string; live: boolean };

export function opayConfig(env: Record<string, string | undefined> = process.env): OpayConfig | null {
  const merchantId = env.OPAY_MERCHANT_ID?.trim();
  const publicKey = env.OPAY_PUBLIC_KEY?.trim();
  const secretKey = env.OPAY_SECRET_KEY?.trim();
  if (!merchantId || !publicKey || !secretKey) return null;
  const live = env.OPAY_ENV?.trim().toLowerCase() === "live";
  return { merchantId, publicKey, secretKey, live, base: live ? "https://api.opaycheckout.com" : "https://sandboxapi.opaycheckout.com" };
}

/** TAPIN-INV-1A2B3C4D5E6F */
export function newInvoiceReference(): string {
  return `TAPIN-INV-${randomBytes(6).toString("hex").toUpperCase()}`;
}

/** Naira → kobo (OPay amounts are in the smallest unit). */
export function toKobo(naira: number): number {
  return Math.round(naira * 100);
}

/** JSON with keys sorted at every level: OPay signs the sorted payload. */
export function sortedJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(sort(value));
}

/** HMAC-SHA512 of the sorted JSON body, with the secret key, in hex. */
export function opaySignature(body: string, secretKey: string): string {
  return createHmac("sha512", secretKey).update(body, "utf8").digest("hex");
}

type OpayReply<T> = { code?: string; message?: string; data?: T };

export type CashierResult = { ok: true; url: string; orderNo: string | null } | { ok: false; error: string };

/** Starts a checkout and returns OPay's payment page. Card, bank transfer and USSD are offered there. */
export async function createCashier(cfg: OpayConfig, o: {
  reference: string; amountNaira: number; returnUrl: string; callbackUrl: string; cancelUrl: string;
  description: string; user: { id: string; name: string; email?: string | null; phone?: string | null }; clientIp?: string;
}, fetchImpl: typeof fetch = fetch): Promise<CashierResult> {
  const body = sortedJson({
    country: "NG", reference: o.reference, amount: { total: toKobo(o.amountNaira), currency: "NGN" },
    returnUrl: o.returnUrl, callbackUrl: o.callbackUrl, cancelUrl: o.cancelUrl, expireAt: 30,
    ...(o.clientIp ? { userClientIP: o.clientIp } : {}),
    userInfo: { userId: o.user.id, userName: o.user.name.slice(0, 60), ...(o.user.email ? { userEmail: o.user.email } : {}), ...(o.user.phone ? { userMobile: o.user.phone } : {}) },
    productList: [{ productId: o.reference, name: "TapIn", description: o.description.slice(0, 100), price: toKobo(o.amountNaira), quantity: 1 }],
  });
  try {
    const res = await fetchImpl(`${cfg.base}/api/v1/international/cashier/create`, {
      method: "POST", body, signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.publicKey}`, MerchantId: cfg.merchantId },
    });
    const r = (await res.json().catch(() => ({}))) as OpayReply<{ cashierUrl?: string; orderNo?: string }>;
    if (r.code === "00000" && r.data?.cashierUrl?.startsWith("https://")) return { ok: true, url: r.data.cashierUrl, orderNo: r.data.orderNo ?? null };
    return { ok: false, error: r.message ? `OPay: ${r.message}` : `OPay ${res.status}` };
  } catch {
    return { ok: false, error: "Couldn't reach OPay." };
  }
}

export type OpayStatus = { status: "INITIAL" | "PENDING" | "SUCCESS" | "FAIL" | "CLOSE"; amountNaira: number; currency: string; reference: string; orderNo: string | null } | null;

/** Asks OPay how a payment stands. Signed with the secret key; null if OPay can't be asked. */
export async function queryCashier(cfg: OpayConfig, reference: string, fetchImpl: typeof fetch = fetch): Promise<OpayStatus> {
  const body = sortedJson({ country: "NG", reference });
  try {
    const res = await fetchImpl(`${cfg.base}/api/v1/international/cashier/status`, {
      method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opaySignature(body, cfg.secretKey)}`, MerchantId: cfg.merchantId },
    });
    const r = (await res.json().catch(() => ({}))) as OpayReply<{ status?: string; reference?: string; orderNo?: string; amount?: { total?: number | string; currency?: string } }>;
    const d = r.data;
    if (r.code !== "00000" || !d?.status) return null;
    const status = (["INITIAL", "PENDING", "SUCCESS", "FAIL", "CLOSE"] as const).find((s) => s === d.status);
    if (!status) return null;
    return { status, amountNaira: Number(d.amount?.total ?? 0) / 100, currency: d.amount?.currency ?? "", reference: d.reference ?? reference, orderNo: d.orderNo ?? null };
  } catch {
    return null;
  }
}

/** Paid in full, in naira, for this reference? */
export function opayPaid(s: OpayStatus, reference: string, expectedNaira: number): boolean {
  return !!s && s.status === "SUCCESS" && s.currency === "NGN" && s.reference === reference && Math.abs(s.amountNaira - expectedNaira) < 0.01;
}
