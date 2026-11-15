import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authenticateKiosk } from "@/lib/kiosk-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { confirmWindow } from "@/lib/handover-server";
import { friendlyTime } from "@/lib/time";

const bodySchema = z.object({ handover_id: z.uuid() });

/**
 * POST /api/pickup { handover_id } — staff checked the faces and confirmed. Releases the children who tapped
 * in this kiosk's open pickup window, and only those the person (or code) may collect.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateKiosk(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Tap the card or enter the code again." }, { status: 400 });

  const r = await confirmWindow(createAdminClient(), auth.device, parsed.data.handover_id, new Date());
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ...r, time: friendlyTime(new Date(), auth.device.school.timezone) }, { headers: { "Cache-Control": "no-store" } });
}
