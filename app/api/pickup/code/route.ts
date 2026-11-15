import { NextResponse, type NextRequest } from "next/server";
import { authenticateKiosk } from "@/lib/kiosk-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimitShared } from "@/lib/rate-limit-shared";
import { hashPickupCode, normalisePickupCode } from "@/lib/pickup";
import { pickupCodeEntry } from "@/lib/pickup-server";
import { afterWrongCode, codeLocked } from "@/lib/handover";
import { friendlyTime } from "@/lib/time";

const LOCKED = "Code entry is locked after too many wrong codes. Please see the admin office.";

/**
 * POST /api/pickup/code { code } — a one-day pickup code typed at the kiosk. It opens a pickup window: the
 * child then taps their card. Five wrong codes lock code entry on this kiosk for 15 minutes and tell the office.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateKiosk(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { device } = auth;
  const db = createAdminClient();
  const now = new Date();

  const { data: dev } = await db.from("devices").select("code_failures, code_locked_until").eq("id", device.id).single();
  if (codeLocked(dev?.code_locked_until as string | null, now)) return NextResponse.json({ error: LOCKED }, { status: 423 });
  if (!(await checkRateLimitShared(`pickup-code:${device.id}`, { max: 8, windowMs: 10 * 60_000 })).ok) {
    return NextResponse.json({ error: "Too many wrong codes. Please see the admin office." }, { status: 429 });
  }
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const code = normalisePickupCode(body?.code);
  if (!code) return NextResponse.json({ error: "Enter the 6-digit code." }, { status: 400 });

  const offer = await pickupCodeEntry(db, device, hashPickupCode(device.school.id, code), "CODE");
  if (!offer) {
    const next = afterWrongCode((dev?.code_failures as number | undefined) ?? 0, now);
    await db.from("devices").update({ code_failures: next.failures, code_locked_until: next.lockedUntil?.toISOString() ?? null }).eq("id", device.id);
    if (next.lockedUntil) {
      await db.from("notifications").insert({
        school_id: device.school.id, kind: "code_lock",
        message: `Pickup code entry on ${device.name} locked at ${friendlyTime(now, device.school.timezone)} after 5 wrong codes. It unlocks in 15 minutes.`,
        dedupe_key: `code-lock:${device.id}:${now.toISOString().slice(0, 16)}`,
      }).then(({ error }) => error && error.code !== "23505" && console.error("code lock notice", error));
      return NextResponse.json({ error: LOCKED }, { status: 423 });
    }
    return NextResponse.json({ error: "That code isn't valid today. Check it, or see the admin office." }, { status: 404 });
  }
  if (dev?.code_failures) await db.from("devices").update({ code_failures: 0 }).eq("id", device.id);
  return NextResponse.json({ ...offer, time: friendlyTime(now, device.school.timezone) }, { headers: { "Cache-Control": "no-store" } });
}
