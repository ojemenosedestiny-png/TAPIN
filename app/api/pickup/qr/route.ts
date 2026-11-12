import { NextResponse, type NextRequest } from "next/server";
import { authenticateKiosk } from "@/lib/kiosk-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimitShared } from "@/lib/rate-limit-shared";
import { hashPickupCode, hashQrToken, parsePickupQr } from "@/lib/pickup";
import { pickupCodeEntry, pickupQrScan } from "@/lib/pickup-server";
import { friendlyTime } from "@/lib/time";

/**
 * POST /api/pickup/qr { text } — a QR code scanned by the kiosk camera: a pickup pass ("TAPIN-P:…")
 * or a one-day code ("TAPIN-C:123456"). Answers exactly like a pickup card or a typed code.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateKiosk(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { device } = auth;
  if (!(await checkRateLimitShared(`pickup-qr:${device.id}`, { max: 20, windowMs: 10 * 60_000 })).ok) {
    return NextResponse.json({ error: "Too many scans. Please see the admin office." }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const qr = parsePickupQr(body?.text);
  if (!qr) return NextResponse.json({ error: "That isn't a TapIn pickup QR code." }, { status: 400 });

  const db = createAdminClient();
  const time = friendlyTime(new Date(), device.school.timezone);
  const offer = qr.kind === "pass"
    ? await pickupQrScan(db, device, hashQrToken(qr.token))
    : await pickupCodeEntry(db, device, hashPickupCode(device.school.id, qr.code), "QR");
  if (!offer) return NextResponse.json({ action: "not_authorised", name: "Unknown QR code", time });
  return NextResponse.json({ ...offer, time }, { headers: { "Cache-Control": "no-store" } });
}
