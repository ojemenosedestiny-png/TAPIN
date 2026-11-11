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
import { pickupCardTap, type Picker } from "@/lib/pickup-server";
import type { PickupChild } from "@/lib/pickup";
import { decideStaffTap, directorLessonMessage, directorWantsLesson, lessonFlags, minutesBetween, type DirectorMode, type LessonFlag } from "@/lib/lessons";

const bodySchema = z.object({
  uid: z.string().max(64),
  tapped_at: z.string().max(40).optional(), // ISO time of an offline tap
  client_id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
});

export type TapAction = "signed_in" | "signed_out" | "duplicate" | "unknown" | "blocked" | "menu" | "lesson_started" | "lesson_ended" | "pickup" | "picked_up" | "not_authorised";
export type LessonChoice = { class_id: string; class_name: string; subject_id: string; subject_name: string };
export type LessonOptions = { assignments: LessonChoice[]; classes: { id: string; name: string }[]; subjects: { id: string; name: string }[] };
export type TapResponse = {
  action: TapAction;
  name?: string;
  first_name?: string;
  photo_url?: string | null;
  class?: string | null;
  /** Admission number for students; empty for staff. */
  id_no?: string | null;
  time: string;
  greeting?: string;
  late?: boolean;
  early?: boolean;
  reason?: string;
  replayed?: boolean;
  /** Teacher menu: the tap to quote back to /api/lesson, and what they can start. */
  tap_id?: number;
  options?: LessonOptions;
  /** Lesson started or ended. */
  subject?: string;
  minutes?: number;
  flags?: LessonFlag[];
  /** Safe pickup: who is collecting, and the children they may take. */
  picker?: Picker;
  children?: PickupChild[];
  /** Picked up: first names to speak. */
  spoken?: string;
};

const PLAIN_RESULTS: readonly TapAction[] = ["signed_in", "signed_out", "duplicate", "unknown", "blocked"];

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
    if (prev) {
      const action = PLAIN_RESULTS.includes(prev.result as TapAction) ? (prev.result as TapAction) : "duplicate";
      return json({ action, late: prev.late, time, replayed: true });
    }
  }

  const uid = normaliseUid(parsed.data.uid);
  const log = async (result: TapAction | "pickup", extra: { holder_type?: string; holder_id?: string; late?: boolean } = {}): Promise<number | null> => {
    const { data, error } = await db.from("tap_events").insert({
      school_id: school.id, device_id: device.id, uid: uid ?? parsed.data.uid.slice(0, 64), result,
      tapped_at: tappedAt.toISOString(), client_id: parsed.data.client_id ?? null, ...extra,
    }).select("id").single();
    // 23505 = the same offline tap raced in twice; the first one wins.
    if (error && error.code !== "23505") console.error("tap_events insert", error);
    return (data?.id as number | undefined) ?? null;
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
    // Safe pickup card?
    const pickup = await pickupCardTap(db, device, uid, tappedAt, log).catch((e) => { console.error("pickup tap", e); return null; });
    if (pickup) return json({ ...pickup, time } as TapResponse);
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

  const photoFor = async () => {
    if (!person.photo) return null;
    const { data } = await db.storage.from(PHOTO_BUCKET).createSignedUrl(person.photo, 120);
    return data?.signedUrl ?? null;
  };

  // Teachers, when the school uses lessons: arrival, then Start lesson / Sign out, then the next tap ends the lesson.
  if (card.holder_type === "staff") {
    const { data: rules } = await db.from("lesson_settings").select("enabled, min_minutes, max_minutes, director_phone, director_alerts").eq("school_id", school.id).maybeSingle();
    if (rules?.enabled) {
      const lesson = await staffLessonTap(db, device, { staffId: card.holder_id, tappedAt, rules, log });
      if (lesson) {
        const director = rules.director_phone;
        const msg = lesson.directorMessage;
        if (msg && director) {
          runAfter("director alert", async () => {
            const { error } = await db.from("sms_logs").insert({ school_id: school.id, phone: director, message: msg.text, type: "director", dedupe_key: `lesson:${msg.lessonId}` });
            if (error && error.code !== "23505") console.error("director alert", error);
            else await processOutbox(db, { limit: 5, schoolId: school.id });
          });
        }
        return json({
          ...lesson.response, name: person.name, first_name: person.firstName, photo_url: await photoFor(), class: lesson.response.class ?? person.className, time,
          greeting: greetingForHour(localHour(tappedAt, school.timezone)),
        });
      }
    }
  }

  const decision = await applyTap(db, device, card.holder_type, card.holder_id, tappedAt);
  const action: TapAction = decision.kind === "sign_in" ? "signed_in" : decision.kind === "sign_out" ? "signed_out" : "duplicate";
  const late = decision.kind === "sign_in" && decision.late;
  const early = decision.kind === "sign_out" && decision.early;
  const releaseReason = "releaseReason" in decision ? decision.releaseReason : undefined;
  await log(action, { holder_type: card.holder_type, holder_id: card.holder_id, late });

  // Guardian SMS: saved to sms_logs first, then sent — after the kiosk already has its answer.
  if (card.holder_type === "student" && (action === "signed_in" || action === "signed_out")) {
    runAfter("tap alerts", async () => {
      const queued = await queueTapAlerts(db, {
        school: { id: school.id, name: school.name, timezone: school.timezone },
        student: { id: card.holder_id, firstName: person.firstName, fullName: person.name, classId: person.classId, className: person.className },
        action, late, tappedAt, early, reason: releaseReason,
      });
      if (queued) await processOutbox(db, { limit: 20, schoolId: school.id });
    });
  }

  const photoUrl = await photoFor();

  return json({
    action,
    name: person.name,
    first_name: person.firstName,
    photo_url: photoUrl,
    class: person.className,
    id_no: person.idNo,
    time,
    greeting: greetingForHour(localHour(tappedAt, school.timezone)),
    late,
    early,
    reason: decision.kind === "duplicate" ? decision.reason : undefined,
  });
}

type Db = ReturnType<typeof createAdminClient>;

type LessonRulesRow = { min_minutes: number; max_minutes: number; director_phone: string | null; director_alerts: string };
type LessonTapResult = { response: Omit<TapResponse, "time">; directorMessage?: { lessonId: string; text: string } };

/**
 * A teacher's tap when lessons are on. Returns null when it is a plain attendance tap
 * (arrival, or after signing out), which the normal rules handle.
 */
async function staffLessonTap(db: Db, device: KioskDevice, opts: {
  staffId: string; tappedAt: Date; rules: LessonRulesRow;
  log: (result: TapAction, extra?: { holder_type?: string; holder_id?: string }) => Promise<number | null>;
}): Promise<LessonTapResult | null> {
  const { staffId, tappedAt, rules, log } = opts;
  const school = device.school;
  const date = localDate(tappedAt, school.timezone);
  const holder = { holder_type: "staff", holder_id: staffId };

  const [{ data: last }, openRes, { data: today }] = await Promise.all([
    db.from("tap_events").select("tapped_at").eq("holder_type", "staff").eq("holder_id", staffId)
      .in("result", ["signed_in", "signed_out", "duplicate", "menu", "lesson_ended"]).order("tapped_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("lessons").select("id, date, started_at, class_name, subject_name").eq("staff_id", staffId).eq("status", "open").maybeSingle(),
    db.from("attendance").select("sign_in_at, sign_out_at").eq("school_id", school.id).eq("holder_type", "staff").eq("holder_id", staffId).eq("date", date).maybeSingle(),
  ]);
  let open = openRes.data;
  // Left open on an earlier day and the auto-close job hasn't run yet: close it now.
  if (open && open.date < date) {
    await db.rpc("auto_close_lessons", { p_school: school.id });
    open = null;
  }

  const decision = decideStaffTap({
    tappedAt, now: new Date(), lastTapAt: last ? new Date(last.tapped_at) : null,
    hasOpenLesson: !!open, signedIn: !!today?.sign_in_at, signedOut: !!today?.sign_out_at,
  });

  if (decision.kind === "attendance") return null;
  if (decision.kind === "duplicate") {
    await log("duplicate", holder);
    return { response: { action: "duplicate", reason: "recent_tap" } };
  }

  if (decision.kind === "end_lesson" && open) {
    const endAt = tappedAt < new Date(open.started_at) ? new Date(open.started_at) : tappedAt;
    const minutes = minutesBetween(new Date(open.started_at), endAt);
    const flags = lessonFlags(minutes, { minMinutes: rules.min_minutes, maxMinutes: rules.max_minutes });
    const { data: ended } = await db.from("lessons").update({ ended_at: endAt.toISOString(), status: "closed", flags, end_device_id: device.id })
      .eq("id", open.id).eq("status", "open").select("id").maybeSingle();
    if (!ended) {
      await log("duplicate", holder);
      return { response: { action: "duplicate", reason: "recent_tap" } };
    }
    await log("lesson_ended", holder);
    const { data: staff } = await db.from("staff").select("name").eq("id", staffId).maybeSingle();
    const wants = directorWantsLesson(rules.director_alerts as DirectorMode, flags);
    return {
      response: { action: "lesson_ended", class: open.class_name, subject: open.subject_name, minutes, flags },
      directorMessage: wants ? {
        lessonId: open.id,
        text: directorLessonMessage({
          teacher: staff?.name ?? "A teacher", className: open.class_name, subject: open.subject_name, minutes, flags, school: school.name,
          start: friendlyTime(open.started_at, school.timezone), end: friendlyTime(endAt, school.timezone),
        }),
      } : undefined,
    };
  }

  // Signed in, nothing open: offer Start lesson / Sign out.
  const tapId = await log("menu", holder);
  if (!tapId) return { response: { action: "duplicate", reason: "recent_tap" } };
  const [{ data: assigned }, { data: classes }, { data: subjects }] = await Promise.all([
    db.from("teacher_assignments").select("class_id, subject_id, classes(name), subjects(name)").eq("staff_id", staffId),
    db.from("classes").select("id, name").eq("school_id", school.id).order("name"),
    db.from("subjects").select("id, name").eq("school_id", school.id).order("name"),
  ]);
  const assignments = (assigned ?? []).map((a) => ({
    class_id: a.class_id as string, subject_id: a.subject_id as string,
    class_name: (a.classes as unknown as { name: string } | null)?.name ?? "",
    subject_name: (a.subjects as unknown as { name: string } | null)?.name ?? "",
  })).filter((a) => a.class_name && a.subject_name).sort((x, y) => x.class_name.localeCompare(y.class_name) || x.subject_name.localeCompare(y.subject_name));
  return { response: { action: "menu", tap_id: tapId, options: { assignments, classes: classes ?? [], subjects: subjects ?? [] } } };
}

async function loadHolder(db: Db, type: string, id: string) {
  if (type === "student") {
    const { data } = await db.from("students").select("first_name, last_name, admission_no, photo_url, status, class_id, classes(name)").eq("id", id).maybeSingle();
    if (!data) return null;
    return {
      name: `${data.first_name} ${data.last_name}`, firstName: data.first_name, photo: data.photo_url as string | null,
      className: (data.classes as unknown as { name: string } | null)?.name ?? null, classId: data.class_id as string | null, idNo: data.admission_no as string | null,
      active: data.status === "active",
    };
  }
  const { data } = await db.from("staff").select("name, photo_url, status").eq("id", id).maybeSingle();
  if (!data) return null;
  return { name: data.name, firstName: data.name.split(" ")[0]!, photo: data.photo_url as string | null, className: "Staff", classId: null, idNo: null, active: data.status === "active" };
}

/**
 * Decides and records the tap. Writes are conditional, so two kiosks tapping the same
 * card at the same moment can't create two sign-ins or overwrite a sign-out.
 */
async function applyTap(db: Db, device: KioskDevice, holderType: string, holderId: string, tappedAt: Date) {
  const school = device.school;
  const day = { timeZone: school.timezone, resumptionTime: school.resumption_time, closingTime: school.closing_time };

  const date = localDate(tappedAt, school.timezone);
  const [{ data: last }, today, { data: release }] = await Promise.all([
    db.from("tap_events").select("tapped_at").eq("holder_type", holderType).eq("holder_id", holderId)
      .in("result", ["signed_in", "signed_out", "duplicate"]).order("tapped_at", { ascending: false }).limit(1).maybeSingle(),
    getRow(),
    db.from("early_releases").select("id, reason").eq("holder_type", holderType).eq("holder_id", holderId).eq("date", date).is("used_at", null).maybeSingle(),
  ]);

  async function getRow() {
    const { data } = await db.from("attendance").select("id, sign_in_at, sign_out_at")
      .eq("school_id", school.id).eq("holder_type", holderType).eq("holder_id", holderId).eq("date", localDate(tappedAt, school.timezone)).maybeSingle();
    return data;
  }

  const decision = decideTap({ tappedAt, lastTapAt: last ? new Date(last.tapped_at) : null, today, school: day, earlyRelease: !!release });

  if (decision.kind === "sign_in") {
    const { error } = await db.from("attendance").insert({
      school_id: school.id, holder_type: holderType, holder_id: holderId, date: decision.date,
      sign_in_at: tappedAt.toISOString(), device_id: device.id,
    });
    if (error?.code === "23505") return { kind: "duplicate" as const, reason: "already_signed_in" as const, date: decision.date };
    if (error) throw error;
  } else if (decision.kind === "sign_out" && today) {
    const { data, error } = await db.from("attendance").update({ sign_out_at: tappedAt.toISOString(), early_release: decision.early })
      .eq("id", today.id).is("sign_out_at", null).select("id");
    if (error) throw error;
    if (!data?.length) return { kind: "duplicate" as const, reason: "already_signed_out" as const, date: decision.date };
    if (decision.early && release) {
      await db.from("early_releases").update({ used_at: tappedAt.toISOString() }).eq("id", release.id);
      return { ...decision, releaseReason: release.reason as string };
    }
  }
  return decision;
}
