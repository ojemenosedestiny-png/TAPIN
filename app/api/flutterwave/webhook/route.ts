import { NextResponse, type NextRequest } from "next/server";
import { flutterwaveKey, validWebhookHash } from "@/lib/flutterwave";
import { settlePayment } from "@/lib/payments";

/**
 * POST /api/flutterwave/webhook: Flutterwave tells us a payment went through (even if the payer closed the page).
 * Checked against the secret hash; we still re-check with Flutterwave before marking anything paid.
 * Set this URL and a secret hash in Flutterwave → Settings → Webhooks, and the same hash as FLW_SECRET_HASH.
 */
export async function POST(req: NextRequest) {
  if (!flutterwaveKey()) return NextResponse.json({ error: "Payments are off." }, { status: 503 });
  if (!validWebhookHash(process.env.FLW_SECRET_HASH?.trim(), req.headers.get("verif-hash"))) {
    return NextResponse.json({ error: "Not from Flutterwave." }, { status: 401 });
  }
  const event = (await req.json().catch(() => null)) as { event?: string; data?: { tx_ref?: string } } | null;
  if (event?.event === "charge.completed" && event.data?.tx_ref) await settlePayment(event.data.tx_ref);
  return NextResponse.json({ received: true });
}
