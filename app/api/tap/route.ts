import { NextResponse, type NextRequest } from "next/server";
import { runAfter } from "@/lib/background";
import { z } from "zod";
import { authenticateKiosk, type KioskDevice } from "@/lib/kiosk-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { normaliseUid } from "@/lib/nfc";
import { decideTap, resolveTapTime } from "@/lib/attendance";
import { greetingForHour } from "@/lib/greeting";
import { friendlyTime, localDate, localHour } from "@/lib/time";
import { PHOTO_BUCKET } from "@/lib/photos";
import { processOutbox, queueTapAlerts } from "@/lib/alerts";

const bodySchema = z.object({
  uid: z.string().max(64),
  tapped_at: z.string().max(40).optional(), // ISO time of an offline tap
  client_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
});

export type TapAction = "signed_in" | "signed_out" | "duplicate" | "unknown" | "blocked";
export type TapResponse = {
  action: TapAction;
  name?: string;
  first_name?: string;
  photo_url?: string | null;
  class?: string | null;
  time: string;
  greeting?: string;
  late?: boolean;
  reason?: string;
  replayed?: boolean;
};

const json = (body: TapResponse | { error: string }, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/**
 * POST /api/tap — called by the kiosk with its device token (build plan §4).
 * The kiosk only ever learns the tapped person's name, photo, class and time.
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
  if (!parsed.success) return json({ error: "Invalid tap." }, 400);

  const now = new Date();
  const when = resolveTapTime(parsed.data.tapped_at, now);
  if (!when.ok) return json({ error: `Tap time rejected (${when.reason}).` }, 400);
  const tappedAt = when.at;
  const time = friendlyTime(tappedAt, school.timezone);
  const db = createAdminClient();

  // Replay of an offline tap we already processed → answer the same way, change nothing.
  if (parsed.data.client_id) {
    const { data: prev } = await db.from("tap_events").select("result, late").eq("device_id", device.id).eq("client_id", parsed.data.client_id).maybeSingle();
    if (prev) return json({ action: prev.result as TapAction, late: prev.late, time, replayed: true });
  }

  const uid = normaliseUid(parsed.data.uid);
  const log = async (result: TapAction, extra: { holder_type?: string; holder_id?: string; late?: boolean } = {}) => {
    const { error } = await db.from("tap_events").insert({
      school_id: school.id, device_id: device.id, uid: uid ?? parsed.data.uid.slice(0, 64), result,
      tapped_at: tappedAt.toISOString(), client_id: parsed.data.client_id ?? null, ...extra,
    });
    // 23505 = the same offline tap raced in twice; the first one wins.
    if (error && error.code !== "23505") console.error("tap_events insert", error);
  };

  const notifyUnknown = (kind: "Unrecognised" | "Blocked") =>
    runAfter("unknown card", async () => {
      const { error } = await db.from("notifications").insert({
        school_id: school.id, kind: "unknown_card",
        message: `${kind} card tapped at ${device.name}, ${time}.`,
        dedupe_key: `card:${uid ?? "invalid"}:${localDate(tappedAt, school.timezone)}`,
      });
      if (error && error.code !== "23505") console.error("unknown card notification", error);
    });

  if (!uid) {
    await log("unknown");
    notifyUnknown("Unrecognised");
    return json({ action: "unknown", time });
  }

  const { data: card } = await db.from("cards").select("id, holder_type, holder_id, status").eq("uid", uid).eq("school_id", school.id).maybeSingle();
  if (!card) {
    await log("unknown");
    notifyUnknown("Unrecognised");
    return json({ action: "unknown", time });
  }
  if (card.status !== "active") {
    await log("blocked", { holder_type: card.holder_type, holder_id: card.holder_id });
    notifyUnknown("Blocked");
    return json({ action: "blocked", time });
  }

  const person = await loadHolder(db, card.holder_type, card.holder_id);
  if (!person || !person.active) {
    await log("blocked", { holder_type: card.holder_type, holder_id: card.holder_id });
    return json({ action: "blocked", time });
  }

  const decision = await applyTap(db, device, card.holder_type, card.holder_id, tappedAt);
  const action: TapAction = decision.kind === "sign_in" ? "signed_in" : decision.kind === "sign_out" ? "signed_out" : "duplicate";
  const late = decision.kind === "sign_in" && decision.late;
  await log(action, { holder_type: card.holder_type, holder_id: card.holder_id, late });

  // Guardian SMS: saved to sms_logs first, then sent — after the kiosk already has its answer.
  if (card.holder_type === "student" && (action === "signed_in" || action === "signed_out")) {
    runAfter("tap alerts", async () => {
      const queued = await queueTapAlerts(db, {
        school: { id: school.id, name: school.name, timezone: school.timezone },
        student: { id: card.holder_id, firstName: person.firstName, fullName: person.name, classId: person.classId, className: person.className },
        action, late, tappedAt,
      });
      if (queued) await processOutbox(db, { limit: 20, schoolId: school.id });
    });
  }

  let photoUrl: string | null = null;
  if (person.photo) {
    const { data } = await db.storage.from(PHOTO_BUCKET).createSignedUrl(person.photo, 120);
    photoUrl = data?.signedUrl ?? null;
  }

  return json({
    action,
    name: person.name,
    first_name: person.firstName,
    photo_url: photoUrl,
    class: person.className,
    time,
    greeting: greetingForHour(localHour(tappedAt, school.timezone)),
    late,
    reason: decision.kind === "duplicate" ? decision.reason : undefined,
  });
}

type Db = ReturnType<typeof createAdminClient>;

async function loadHolder(db: Db, type: string, id: string) {
  if (type === "student") {
    const { data } = await db.from("students").select("first_name, last_name, photo_url, status, class_id, classes(name)").eq("id", id).maybeSingle();
    if (!data) return null;
    return {
      name: `${data.first_name} ${data.last_name}`, firstName: data.first_name, photo: data.photo_url as string | null,
      className: (data.classes as unknown as { name: string } | null)?.name ?? null, classId: data.class_id as string | null,
      active: data.status === "active",
    };
  }
  const { data } = await db.from("staff").select("name, photo_url, status").eq("id", id).maybeSingle();
  if (!data) return null;
  return { name: data.name, firstName: data.name.split(" ")[0]!, photo: data.photo_url as string | null, className: "Staff", classId: null, active: data.status === "active" };
}

/**
 * Decides and records the tap. Writes are conditional, so two kiosks tapping the same
 * card at the same moment can't create two sign-ins or overwrite a sign-out.
 */
async function applyTap(db: Db, device: KioskDevice, holderType: string, holderId: string, tappedAt: Date) {
  const school = device.school;
  const day = { timeZone: school.timezone, resumptionTime: school.resumption_time, closingTime: school.closing_time };

  const [{ data: last }, today] = await Promise.all([
    db.from("tap_events").select("tapped_at").eq("holder_type", holderType).eq("holder_id", holderId)
      .in("result", ["signed_in", "signed_out", "duplicate"]).order("tapped_at", { ascending: false }).limit(1).maybeSingle(),
    getRow(),
  ]);

  async function getRow() {
    const { data } = await db.from("attendance").select("id, sign_in_at, sign_out_at")
      .eq("school_id", school.id).eq("holder_type", holderType).eq("holder_id", holderId).eq("date", localDate(tappedAt, school.timezone)).maybeSingle();
    return data;
  }

  const decision = decideTap({ tappedAt, lastTapAt: last ? new Date(last.tapped_at) : null, today, school: day });

  if (decision.kind === "sign_in") {
    const { error } = await db.from("attendance").insert({
      school_id: school.id, holder_type: holderType, holder_id: holderId, date: decision.date,
      sign_in_at: tappedAt.toISOString(), device_id: device.id,
    });
    if (error?.code === "23505") return { kind: "duplicate" as const, reason: "already_signed_in" as const, date: decision.date };
    if (error) throw error;
  } else if (decision.kind === "sign_out" && today) {
    const { data, error } = await db.from("attendance").update({ sign_out_at: tappedAt.toISOString() })
      .eq("id", today.id).is("sign_out_at", null).select("id");
    if (error) throw error;
    if (!data?.length) return { kind: "duplicate" as const, reason: "already_signed_out" as const, date: decision.date };
  }
  return decision;
}
