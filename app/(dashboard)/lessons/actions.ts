"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSchoolArea } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAudit } from "@/lib/audit";
import { fieldErrors, idSchema } from "@/lib/validation";
import { normaliseNgPhone } from "@/lib/phone";
import type { ActionState } from "@/components/forms/field";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time, e.g. 17:00.");

const settingsSchema = z.object({
  enabled: z.boolean(),
  min_minutes: z.coerce.number({ message: "Enter minutes." }).int().min(1, "At least 1 minute.").max(600),
  max_minutes: z.coerce.number({ message: "Enter minutes." }).int().min(2).max(720, "At most 12 hours."),
  autoclose_time: time,
  director_alerts: z.enum(["off", "every", "flagged", "daily"]),
  director_phone: z.string().trim().max(20),
  director_summary_time: time,
}).refine((v) => v.max_minutes > v.min_minutes, { path: ["max_minutes"], message: "Must be longer than the shortest lesson." });

/** Lessons on/off, the short/long rules, auto-close time and the director's alerts. */
export async function saveLessonSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("lessons");
  const parsed = settingsSchema.safeParse({ ...Object.fromEntries(fd), enabled: fd.get("enabled") === "on" });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const v = parsed.data;
  const phone = v.director_phone ? normaliseNgPhone(v.director_phone) : null;
  if (v.director_phone && !phone) return { errors: { director_phone: "Enter a Nigerian phone number, e.g. 0803 123 4567." } };
  if (v.director_alerts !== "off" && !phone) return { errors: { director_phone: "Add the director's phone number to send alerts." } };

  const db = createAdminClient();
  const { error } = await db.from("lesson_settings").upsert({
    school_id: user.schoolId, enabled: v.enabled, min_minutes: v.min_minutes, max_minutes: v.max_minutes, autoclose_time: v.autoclose_time,
    director_phone: phone, director_alerts: v.director_alerts, director_summary_time: v.director_summary_time, updated_at: new Date().toISOString(),
  });
  if (error) return { errors: { _form: "Could not save. Please try again." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "lessons.settings", entity: "lesson_settings", entityId: user.schoolId,
    details: { enabled: v.enabled, min: v.min_minutes, max: v.max_minutes, autoclose: v.autoclose_time, director_alerts: v.director_alerts } });
  revalidatePath("/lessons");
  return { ok: v.enabled ? "Saved. Teachers now get Start lesson and Sign out at the kiosk." : "Saved. Lessons are off." };
}

const subjectSchema = z.object({ name: z.string().trim().min(1, "Enter a subject.").max(60, "Keep it under 60 characters.") });

export async function addSubject(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("lessons");
  const parsed = subjectSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const db = createAdminClient();
  const { data, error } = await db.from("subjects").insert({ school_id: user.schoolId, name: parsed.data.name }).select("id").single();
  if (error?.code === "23505") return { errors: { name: "That subject is already on the list." } };
  if (error || !data) return { errors: { _form: "Could not add the subject." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "subject.create", entity: "subjects", entityId: data.id, details: { name: parsed.data.name } });
  revalidatePath("/lessons/setup");
  return { ok: `${parsed.data.name} added.` };
}

export async function deleteSubject(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("lessons");
  const id = idSchema.safeParse(fd.get("id"));
  if (!id.success) return { errors: { _form: "Invalid subject." } };
  const db = createAdminClient();
  const { data } = await db.from("subjects").delete().eq("id", id.data).eq("school_id", user.schoolId).select("name").maybeSingle();
  if (!data) return { errors: { _form: "That subject wasn't found." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "subject.delete", entity: "subjects", entityId: id.data, details: { name: data.name } });
  revalidatePath("/lessons/setup");
  return { ok: `${data.name} removed. Past lessons keep their subject name.` };
}

const assignSchema = z.object({
  staff_id: idSchema.or(z.literal("")).refine((v) => v !== "", "Choose a teacher."),
  class_id: idSchema.or(z.literal("")).refine((v) => v !== "", "Choose a class."),
  subject_id: idSchema.or(z.literal("")).refine((v) => v !== "", "Choose a subject."),
});

/** "Mrs Obi teaches JSS 2 Mathematics": the kiosk offers this first when she starts a lesson. */
export async function addAssignment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("lessons");
  const parsed = assignSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const db = createAdminClient();
  const { error } = await db.from("teacher_assignments").insert({ school_id: user.schoolId, ...parsed.data });
  if (error?.code === "23505") return { errors: { _form: "That teacher already has this class and subject." } };
  if (error) return { errors: { _form: "Could not save. Check the teacher, class and subject." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "assignment.create", entity: "teacher_assignments", details: parsed.data });
  revalidatePath("/lessons/setup");
  return { ok: "Added." };
}

export async function removeAssignment(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireSchoolArea("lessons");
  const id = idSchema.safeParse(fd.get("id"));
  if (!id.success) return { errors: { _form: "Invalid entry." } };
  const db = createAdminClient();
  const { data } = await db.from("teacher_assignments").delete().eq("id", id.data).eq("school_id", user.schoolId).select("id").maybeSingle();
  if (!data) return { errors: { _form: "That entry wasn't found." } };
  await writeAudit({ schoolId: user.schoolId, actorId: user.id, action: "assignment.delete", entity: "teacher_assignments", entityId: id.data });
  revalidatePath("/lessons/setup");
  return { ok: "Removed." };
}
