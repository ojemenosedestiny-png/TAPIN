/**
 * Flutterwave (v3 Standard checkout), through its REST API (no library). Server only.
 * Env:
 *   FLW_SECRET_KEY   secret key (FLWSECK-… or FLWSECK_TEST-…). Without it, online payment is off and orders are
 *                    saved for an invoice instead.
 *   FLW_SECRET_HASH  the "secret hash" you set in Flutterwave → Settings → Webhooks; Flutterwave sends it back in
 *                    the verif-hash header so we know a webhook is genuine.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { PayMethod } from "@/lib/pricing";

const API = "https://api.flutterwave.com/v3";

export function flutterwaveKey(): string | null {
  return process.env.FLW_SECRET_KEY?.trim() || null;
}

/** Our payment reference (Flutterwave's tx_ref): readable prefix + random part. */
export function newReference(prefix: "SCH" | "PAR"): string {
  return `TAPIN-${prefix}-${randomBytes(6).toString("hex").toUpperCase()}`;
}

const OPTIONS: Record<PayMethod, string> = { card: "card", transfer: "banktransfer", ussd: "ussd" };

export type InitResult = { ok: true; url: string } | { ok: false; error: string };

/** Starts a payment and returns Flutterwave's checkout page to send the payer to. Amount in naira. */
export async function initializePayment(opts: {
  key: string; email: string; phone?: string; name?: string; amount: number; reference: string; method: PayMethod;
  redirectUrl: string; meta: Record<string, string | number>;
}, fetchImpl: typeof fetch = fetch): Promise<InitResult> {
  try {
    const res = await fetchImpl(`${API}/payments`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        tx_ref: opts.reference,
        amount: Math.round(opts.amount * 100) / 100,
        currency: "NGN",
        redirect_url: opts.redirectUrl,
        payment_options: OPTIONS[opts.method],
        customer: { email: opts.email, ...(opts.phone ? { phone_number: opts.phone } : {}), ...(opts.name ? { name: opts.name } : {}) },
        customizations: { title: "TapIn" },
        meta: opts.meta,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { status?: string; message?: string; data?: { link?: string } };
    if (res.ok && body.status === "success" && body.data?.link) return { ok: true, url: body.data.link };
    return { ok: false, error: body.message ?? `Flutterwave ${res.status}` };
  } catch {
    return { ok: false, error: "Couldn't reach the payment provider." };
  }
}

export type Verified = { paid: boolean; amount: number; reference: string } | null;

/** Asks Flutterwave whether a reference was paid, in naira, and for how much. Never trust the redirect alone. */
export async function verifyPayment(key: string, reference: string, fetchImpl: typeof fetch = fetch): Promise<Verified> {
  try {
    const res = await fetchImpl(`${API}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${key}` }, cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { status?: string; data?: { status?: string; amount?: number; currency?: string; tx_ref?: string } };
    if (!res.ok || body.status !== "success" || !body.data) return null;
    const d = body.data;
    return { paid: d.status === "successful" && d.currency === "NGN" && d.tx_ref === reference, amount: Number(d.amount ?? 0), reference: d.tx_ref ?? reference };
  } catch {
    return null;
  }
}

/** Flutterwave puts the secret hash you chose in the verif-hash header of every webhook. */
export function validWebhookHash(secretHash: string | null | undefined, header: string | null): boolean {
  if (!secretHash || !header) return false;
  const a = Buffer.from(secretHash);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}
