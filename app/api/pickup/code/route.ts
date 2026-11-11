import { NextResponse, type NextRequest } from "next/server";
import { authenticateKiosk } from "@/lib/kiosk-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimitShared } from "@/lib/rate-limit-shared";
import { hashPickupCode, normalisePickupCode } from "@/lib/pickup";
import { pickupCodeEntry } from "@/lib/pickup-server";
import { friendlyTime } from "@/lib/time";

/**
 * POST /api/pickup/code { code } — a one-day pickup code typed at the kiosk.
 * Limited to a few tries per kiosk, so codes can't be guessed.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateKiosk(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { device } = auth;
  if (!(await checkRateLimitShared(`pickup-code:${device.id}`, { max: 8, windowMs: 10 * 60_000 })).ok) {
    return NextResponse.json({ error: "Too many wrong codes. Please see the admin office." }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const code = normalisePickupCode(body?.code);
  if (!code) return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });

  const offer = await pickupCodeEntry(createAdminClient(), device, hashPickupCode(device.school.id, code), "CODE");
  if (!offer) return NextResponse.json({ error: "That code isn't valid today. Check it, or see the admin office." }, { status: 404 });
  return NextResponse.json({ ...offer, time: friendlyTime(new Date(), device.school.timezone) }, { headers: { "Cache-Control": "no-store" } });
}
