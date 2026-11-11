import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authenticateKiosk } from "@/lib/kiosk-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimitShared } from "@/lib/rate-limit-shared";
import { getSchoolPlan, planAllows } from "@/lib/plans";
import { checkPin } from "@/lib/emergency";
import { activeEmergency, emergencyCounts, startEmergency } from "@/lib/emergency-server";
import { writeAudit } from "@/lib/audit";

const noStore = { "Cache-Control": "no-store" };

async function status(db: ReturnType<typeof createAdminClient>, schoolId: string) {
  const available = planAllows(await getSchoolPlan(db, schoolId), "emergency");
  const active = available ? await activeEmergency(db, schoolId) : null;
  return { available, active: active ? { ...active, counts: await emergencyCounts(db, active.id) } : null };
}

/** GET /api/emergency — the kiosk checks every few seconds whether a roll call is running. */
export async function GET(req: NextRequest) {
  const auth = await authenticateKiosk(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json(await status(createAdminClient(), auth.device.school.id), { headers: noStore });
}

const startSchema = z.object({ pin: z.string().max(12), kind: z.enum(["real", "drill"]).default("real") });

/** POST /api/emergency { pin, kind } — the kiosk's Emergency button. Premium only, PIN required, few tries. */
export async function POST(req: NextRequest) {
  const auth = await authenticateKiosk(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { device } = auth;
  const db = createAdminClient();
  if (!planAllows(await getSchoolPlan(db, device.school.id), "emergency")) {
    return NextResponse.json({ error: "Emergency roll call is part of TapIn Premium." }, { status: 403 });
  }
  if (!(await checkRateLimitShared(`emergency-pin:${device.id}`, { max: 5, windowMs: 10 * 60_000 })).ok) {
    return NextResponse.json({ error: "Too many wrong PINs. Start the roll call from the dashboard." }, { status: 429 });
  }
  const parsed = startSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the PIN." }, { status: 400 });
  const { data: settings } = await db.from("emergency_settings").select("pin_hash").eq("school_id", device.school.id).maybeSingle();
  if (!settings?.pin_hash) return NextResponse.json({ error: "No emergency PIN is set. The school admin sets it in Emergency." }, { status: 409 });
  if (!checkPin(parsed.data.pin, settings.pin_hash)) return NextResponse.json({ error: "Wrong PIN." }, { status: 401 });

  const started = await startEmergency(db, device.school, { kind: parsed.data.kind, deviceId: device.id, reason: `Started at ${device.name}` });
  if (!started) return NextResponse.json({ error: "Could not start the roll call. Use the dashboard." }, { status: 500 });
  if (started.created) {
    await writeAudit({ schoolId: device.school.id, actorId: null, action: "emergency.start", entity: "emergencies", entityId: started.id, details: { kind: parsed.data.kind, device: device.name } });
    await db.from("notifications").insert({
      school_id: device.school.id, kind: "emergency", message: `Emergency roll call started at ${device.name}.`, dedupe_key: `emergency:${started.id}`,
    });
  }
  return NextResponse.json(await status(db, device.school.id), { headers: noStore });
}
