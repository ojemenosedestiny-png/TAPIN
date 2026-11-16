import { NextResponse, type NextRequest } from "next/server";
import { settleInvoicePayment } from "@/lib/invoice-payments";
import { checkRateLimitShared } from "@/lib/rate-limit-shared";

/**
 * POST /api/opay/callback — OPay's payment notification. It only tells TapIn which reference to look at:
 * the status is then asked from OPay directly (signed), so a forged callback can't mark anything paid.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await checkRateLimitShared(`opay-cb:${ip}`, { max: 60, windowMs: 60_000 })).ok) return NextResponse.json({ ok: false }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { payload?: { reference?: unknown }; reference?: unknown } | null;
  const reference = String(body?.payload?.reference ?? body?.reference ?? "");
  if (!/^TAPIN-INV-[0-9A-F]{12}$/.test(reference)) return NextResponse.json({ ok: true }); // not ours: acknowledge and ignore
  const r = await settleInvoicePayment(reference);
  return NextResponse.json({ ok: true, status: r.status });
}
