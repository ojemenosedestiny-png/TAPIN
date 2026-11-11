"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSchoolArea, type SchoolUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { idSchema } from "@/lib/validation";
import { getSchoolPlan, planAllows } from "@/lib/plans";
import { checkPin, hashPin, validPin } from "@/lib/emergency";
import { activeEmergency, startEmergency } from "@/lib/emergency-server";
import { processOutbox } from "@/lib/alerts";
import { checkRateLimitShared } from "@/lib/rate-limit-shared";
import type { ActionState } from "@/components/forms/field";

async function premiumUser(): Promise<{ user: SchoolUser; db: ReturnType<typeof createAdminClient> } | { error: string }> {
  const user = await requireSchoolArea("emergency");
  const db = createAdminClient();
  if (!planAllows(await getSchoolPlan(db, user.schoolId), "emergency")) return { error: "Emergency roll call is part of TapIn Premium." };
  return { user, db };
}

/** Start a roll call. Admins confirm; teachers also enter the emergency PIN. */
export async function startRollCall(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await premiumUser();
  if ("error" in ctx) return { errors: { _form: ctx.error } };
  const { user, db } = ctx;
  const kind = fd.get("kind") === "drill" ? "drill" : "real";
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 200) || null;
  if (user.role !== "school_admin") {
    if (!(await checkRateLimitShared(`emergency-pin-user:${user.id}`, { max: 5, windowMs: 10 * 60_000 })).ok) return { errors: { pin: "Too many tries. Ask the school admin." } };
    const { data: s } = await db.from("emergency_settings").select("pin_hash").eq("school_id", user.schoolId).maybeSingle();
    if (!checkPin(String(fd.get("pin") ?? ""), s?.pin_hash)) return { errors: { pin: "Wrong PIN." } };
  }
  const { data: school } = await db.from("schools").select("timezone").eq("id", user.schoolId).single();
  const started = await startEmergency(db, { id: user.schoolId, timezone: school?.timezone ?? "Africa/Lagos" }, { kind, reason, userId: user.id });
  if (!started) return { errors: { _form: "Could not start the roll call. Please try again." } };
  if (started.created) await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "emergency.start", entity: "emergencies", entityId: started.id, details: { kind } });
  revalidatePath("/emergency");
  return { ok: started.created ? "Roll call started. Every kiosk now marks people safe." : "A roll call is already running." };
}

const markSchema = z.object({ id: idSchema, safe: z.enum(["1", "0"]) });

/** Tick someone safe on a phone (or untick a mistake). Any team member. */
export async function markPerson(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await premiumUser();
  if ("error" in ctx) return { errors: { _form: ctx.error } };
  const { user, db } = ctx;
  const parsed = markSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: { _form: "Invalid request." } };
  const running = await activeEmergency(db, user.schoolId);
  if (!running) return { errors: { _form: "The roll call has ended." } };
  const safe = parsed.data.safe === "1";
  const { data } = await db.from("emergency_people")
    .update(safe ? { safe_at: new Date().toISOString(), marked_by: user.name } : { safe_at: null, marked_by: null })
    .eq("id", parsed.data.id).eq("emergency_id", running.id).eq("school_id", user.schoolId).select("name").maybeSingle();
  if (!data) return { errors: { _form: "Not found on this roll call." } };
  revalidatePath("/emergency");
  return { ok: safe ? `${data.name} marked safe.` : `${data.name} marked not yet safe.` };
}

/** End the roll call (school admins). */
export async function endRollCall(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await premiumUser();
  if ("error" in ctx) return { errors: { _form: ctx.error } };
  const { user, db } = ctx;
  if (user.role !== "school_admin") return { errors: { _form: "Only a school admin can end the roll call." } };
  const id = idSchema.safeParse(fd.get("id"));
  if (!id.success) return { errors: { _form: "Invalid roll call." } };
  const { data } = await db.from("emergencies").update({ ended_at: new Date().toISOString(), ended_by_user: user.id })
    .eq("id", id.data).eq("school_id", user.schoolId).is("ended_at", null).select("id").maybeSingle();
  if (!data) return { errors: { _form: "Already ended." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "emergency.end", entity: "emergencies", entityId: id.data });
  revalidatePath("/emergency");
  return { ok: "Roll call ended. The incident report is ready." };
}

/** Optional message to the parents of every child on the roll (school admins). Once per roll call. */
export async function broadcastParents(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await premiumUser();
  if ("error" in ctx) return { errors: { _form: ctx.error } };
  const { user, db } = ctx;
  if (user.role !== "school_admin") return { errors: { _form: "Only a school admin can message parents." } };
  const id = idSchema.safeParse(fd.get("id"));
  const message = String(fd.get("message") ?? "").trim();
  if (!id.success) return { errors: { _form: "Invalid roll call." } };
  if (message.length < 10 || message.length > 459) return { errors: { message: "Write a message of 10 to 459 characters (up to 3 SMS)." } };

  const { data: em } = await db.from("emergencies").update({ broadcast_at: new Date().toISOString() })
    .eq("id", id.data).eq("school_id", user.schoolId).is("broadcast_at", null).select("id").maybeSingle();
  if (!em) return { errors: { _form: "Parents were already messaged for this roll call." } };
  const { data: roll } = await db.from("emergency_people").select("holder_id").eq("emergency_id", id.data).eq("holder_type", "student");
  const studentIds = (roll ?? []).map((r) => r.holder_id as string);
  let queued = 0;
  for (let i = 0; i < studentIds.length; i += 300) {
    const { data: links } = await db.from("student_guardians").select("student_id, guardians(id, phone)").in("student_id", studentIds.slice(i, i + 300));
    const rows = (links ?? []).flatMap((l) => {
      const g = l.guardians as unknown as { id: string; phone: string } | null;
      return g?.phone ? [{ school_id: user.schoolId, student_id: l.student_id, guardian_id: g.id, phone: g.phone, message, type: "emergency", dedupe_key: `emergency:${id.data}:${g.id}` }] : [];
    });
    if (rows.length) {
      const { error } = await db.from("sms_logs").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true });
      if (!error) queued += rows.length;
    }
  }
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "emergency.broadcast", entity: "emergencies", entityId: id.data, details: { messages: queued } });
  await processOutbox(db, { limit: 50, schoolId: user.schoolId });
  revalidatePath("/emergency");
  return { ok: `Message queued for ${queued} parent${queued === 1 ? "" : "s"}.` };
}

/** Set the PIN for the kiosk's Emergency button (school admins). */
export async function setEmergencyPin(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("emergency");
  if (user.role !== "school_admin") return { errors: { _form: "Only a school admin can set the PIN." } };
  const pin = String(fd.get("pin") ?? "");
  if (!validPin(pin)) return { errors: { pin: "Use 4 to 6 digits." } };
  if (pin !== String(fd.get("confirm") ?? "")) return { errors: { confirm: "The two PINs don't match." } };
  const { error } = await createAdminClient().from("emergency_settings").upsert({ school_id: user.schoolId, pin_hash: hashPin(pin), updated_at: new Date().toISOString() });
  if (error) return { errors: { _form: "Could not save the PIN." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "emergency.pin", entity: "emergency_settings", entityId: user.schoolId });
  revalidatePath("/emergency");
  return { ok: "Emergency PIN saved. Share it only with staff who may start a roll call." };
}
