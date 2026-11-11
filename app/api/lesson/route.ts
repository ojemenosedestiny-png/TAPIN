import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authenticateKiosk } from "@/lib/kiosk-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { MENU_CHOICE_MS } from "@/lib/lessons";
import { friendlyTime, localDate, localHour } from "@/lib/time";
import { greetingForHour } from "@/lib/greeting";
import { PHOTO_BUCKET } from "@/lib/photos";
import type { TapResponse } from "@/app/api/tap/route";

const bodySchema = z.discriminatedUnion("choice", [
  z.object({ choice: z.literal("start"), tap_id: z.number().int().positive(), class_id: z.uuid(), subject_id: z.uuid() }),
  z.object({ choice: z.literal("sign_out"), tap_id: z.number().int().positive() }),
]);

const json = (body: TapResponse | { error: string }, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * POST /api/lesson — the teacher's choice after a menu tap: start a lesson or sign out.
 * Only valid for a menu tap made on this same kiosk in the last two minutes, so a kiosk can't
 * start lessons for someone who didn't tap. Times come from the server.
 */
export async function POST(req: NextRequest) {
  const auth = await authenticateKiosk(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const { device } = auth;
  const school = device.school;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "Request body must be JSON." }, 400);
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: "Invalid choice." }, 400);
  const input = parsed.data;

  const db = createAdminClient();
  const now = new Date();
  const { data: tap } = await db.from("tap_events").select("id, holder_id, tapped_at")
    .eq("id", input.tap_id).eq("device_id", device.id).eq("school_id", school.id).eq("holder_type", "staff").eq("result", "menu").maybeSingle();
  if (!tap?.holder_id || now.getTime() - new Date(tap.tapped_at).getTime() > MENU_CHOICE_MS) {
    return json({ error: "That took too long. Please tap your card again." }, 409);
  }
  const staffId = tap.holder_id as string;

  const { data: staff } = await db.from("staff").select("name, photo_url, status").eq("id", staffId).maybeSingle();
  if (!staff || staff.status !== "active") return json({ error: "This card is not active." }, 403);
  let photoUrl: string | null = null;
  if (staff.photo_url) {
    const { data } = await db.storage.from(PHOTO_BUCKET).createSignedUrl(staff.photo_url, 120);
    photoUrl = data?.signedUrl ?? null;
  }
  const person = {
    name: staff.name as string, first_name: (staff.name as string).split(" ")[0]!, photo_url: photoUrl,
    time: friendlyTime(now, school.timezone), greeting: greetingForHour(localHour(now, school.timezone)),
  };
  const date = localDate(now, school.timezone);

  if (input.choice === "sign_out") {
    const { data: started } = await db.from("lessons").select("id").eq("start_tap_id", tap.id).maybeSingle();
    if (started) return json({ error: "A lesson was already started from this tap." }, 409);
    await db.from("attendance").update({ sign_out_at: now.toISOString() })
      .eq("school_id", school.id).eq("holder_type", "staff").eq("holder_id", staffId).eq("date", date).is("sign_out_at", null);
    return json({ action: "signed_out", ...person, class: "Staff" });
  }

  const [{ data: cls }, { data: subject }] = await Promise.all([
    db.from("classes").select("id, name").eq("id", input.class_id).eq("school_id", school.id).maybeSingle(),
    db.from("subjects").select("id, name").eq("id", input.subject_id).eq("school_id", school.id).maybeSingle(),
  ]);
  if (!cls || !subject) return json({ error: "Choose a class and a subject." }, 400);

  const { error } = await db.from("lessons").insert({
    school_id: school.id, staff_id: staffId, class_id: cls.id, subject_id: subject.id, class_name: cls.name, subject_name: subject.name,
    date, started_at: now.toISOString(), start_device_id: device.id, start_tap_id: tap.id,
  });
  if (error?.code === "23505") {
    // Same tap sent twice (fine), or a lesson is already open for this teacher.
    const { data: same } = await db.from("lessons").select("class_name, subject_name").eq("start_tap_id", tap.id).maybeSingle();
    if (same) return json({ action: "lesson_started", ...person, class: same.class_name, subject: same.subject_name });
    return json({ error: "You already have a lesson open. Tap your card to end it first." }, 409);
  }
  if (error) {
    console.error("lesson insert", error);
    return json({ error: "Could not start the lesson. Please try again." }, 500);
  }
  return json({ action: "lesson_started", ...person, class: cls.name, subject: subject.name });
}
