import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authenticateKiosk } from "@/lib/kiosk-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { confirmPickup } from "@/lib/pickup-server";
import { PICKUP_CONFIRM_MS } from "@/lib/pickup";
import { friendlyTime } from "@/lib/time";

const bodySchema = z.object({ tap_id: z.number().int().positive(), student_ids: z.array(z.uuid()).min(1).max(20) });

/**
 * POST /api/pickup — staff confirmed a pickup on the kiosk. Only for a pickup tap or code made on
 * this same kiosk in the last few minutes, and only for children that person may collect.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateKiosk(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose at least one child." }, { status: 400 });

  const r = await confirmPickup(createAdminClient(), auth.device, parsed.data.tap_id, parsed.data.student_ids, PICKUP_CONFIRM_MS);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ...r, time: friendlyTime(new Date(), auth.device.school.timezone) }, { headers: { "Cache-Control": "no-store" } });
}
